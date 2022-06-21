import { CodeEditor } from '@jupyterlab/codeeditor';
import {
  Completer,
  CompletionHandler,
  ICompletionContext,
  ICompletionProvider
} from '@jupyterlab/completer';
import { IDocumentWidget } from '@jupyterlab/docregistry';
import { LabIcon } from '@jupyterlab/ui-components';

import { CompletionTriggerKind } from 'vscode-languageserver-protocol';
import * as lsProtocol from 'vscode-languageserver-types';
import {
  ILSPConnection,
  ILSPDocumentConnectionManager,
  VirtualDocument,
  IEditorPosition,
  IRootPosition,
  ISourcePosition,
  IVirtualPosition
} from '@jupyterlab/lsp';

export interface ICompletionsSource {
  /**
   * The name displayed in the GUI
   */
  name: string;
  /**
   * The higher the number the higher the priority
   */
  priority: number;
  /**
   * The icon to be displayed if no type icon is present
   */
  fallbackIcon?: LabIcon;
}

export interface ICompletionsReply
  extends CompletionHandler.ICompletionItemsReply {
  // TODO: it is not clear when the source is set here and when on IExtendedCompletionItem.
  //  it might be good to separate the two stages for both interfaces
  source: ICompletionsSource | null;
  items: CompletionHandler.ICompletionItem[];
}

export class LspCompletionProvider implements ICompletionProvider {
  constructor(options: LspCompletionProvider.IOptions) {
    this._manager = options.manager;
  }

  async isApplicable(context: ICompletionContext): Promise<boolean> {
    return (
      !!context.editor && !!(context.widget as IDocumentWidget).context.path
    );
  }
  async fetch(
    request: CompletionHandler.IRequest,
    context: ICompletionContext
  ): Promise<
    CompletionHandler.ICompletionItemsReply<CompletionHandler.ICompletionItem>
  > {
    const path = (context.widget as IDocumentWidget).context.path;

    const adapter = this._manager.adapters.get(path);
    if (!adapter) {
      return { start: 0, end: 0, items: [] };
    }
    const virtualDocument = adapter.virtualDocument;
    const editor = context.editor! as any;

    const cursor = editor.getCursorPosition();
    const token = editor.getTokenForPosition(cursor);

    const start = editor.getPositionAt(token.offset)!;
    const end = editor.getPositionAt(token.offset + token.value.length)!;

    const positionInToken = cursor.column - start.column - 1;
    const typedCharacter = token.value[cursor.column - start.column - 1];

    const startInRoot = this.transformFromEditorToRoot(
      virtualDocument,
      editor,
      start
    );
    const endInRoot = this.transformFromEditorToRoot(
      virtualDocument,
      editor,
      end
    );
    const cursorInRoot = this.transformFromEditorToRoot(
      virtualDocument,
      editor,
      cursor
    );

    const virtualStart = virtualDocument.virtualPositionAtDocument(
      startInRoot as ISourcePosition
    );
    const virtualEnd = virtualDocument.virtualPositionAtDocument(
      endInRoot as ISourcePosition
    );
    const virtualCursor = virtualDocument.virtualPositionAtDocument(
      cursorInRoot as ISourcePosition
    );
    const lspPromise: Promise<
      CompletionHandler.ICompletionItemsReply | undefined
    > = this.fetchLsp(
      token,
      typedCharacter,
      virtualStart,
      virtualEnd,
      virtualCursor,
      virtualDocument,
      positionInToken
    );

    const promise = Promise.all([lspPromise.catch(p => p)]).then(([lsp]) => {
      return lsp;
    });

    return promise;
  }

  // async resolve(
  //   completionItem: LazyCompletionItem,
  //   context: ICompletionContext,
  //   patch?: Completer.IPatch | null
  // ): Promise<LazyCompletionItem> {
  //   const resolvedCompletionItem = await completionItem.lspResolve();

  //   return {
  //     ...completionItem,
  //     documentation: resolvedCompletionItem.documentation
  //   } as any;
  // }
  transformFromEditorToRoot(
    virtualDocument: VirtualDocument,
    editor: CodeEditor.IEditor,
    position: CodeEditor.IPosition
  ): IRootPosition | null {
    const editorPosition = VirtualDocument.ceToCm(position) as IEditorPosition;
    return virtualDocument.transformFromEditorToRoot(editor, editorPosition);
  }

  getConnection(uri: string): ILSPConnection | undefined {
    return this._manager.connections.get(uri);
  }

  async fetchLsp(
    token: CodeEditor.IToken,
    typedCharacter: string,
    start: IVirtualPosition,
    end: IVirtualPosition,
    cursor: IVirtualPosition,
    document: VirtualDocument,
    positionInToken: number
  ): Promise<ICompletionsReply> {
    const connection = this.getConnection(document.uri)!;

    const triggerKind = CompletionTriggerKind.Invoked;
    const lspCompletionItems = ((await connection.getCompletion(
      cursor,
      {
        start,
        end,
        text: token.value
      },
      document.documentInfo,
      false,
      typedCharacter,
      triggerKind
    )) ?? []) as lsProtocol.CompletionItem[];
    let prefix = token.value.slice(0, positionInToken + 1);
    let allNonPrefixed = true;
    const items = [] as CompletionHandler.ICompletionItem[];
    lspCompletionItems.forEach(match => {
      // Update prefix values
      const text = match.insertText ? match.insertText : match.label;

      // declare prefix presence if needed and update it
      if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        allNonPrefixed = false;
        if (prefix !== token.value) {
          if (text.toLowerCase().startsWith(token.value.toLowerCase())) {
            // given a completion insert text "display_table" and two test cases:
            // disp<tab>data →  display_table<cursor>data
            // disp<tab>lay  →  display_table<cursor>
            // we have to adjust the prefix for the latter (otherwise we would get display_table<cursor>lay),
            // as we are constrained NOT to replace after the prefix (which would be "disp" otherwise)
            prefix = token.value;
          }
        }
      }
      // add prefix if needed
      else if (token.type === 'string' && prefix.includes('/')) {
        // special case for path completion in strings, ensuring that:
        //     '/Com<tab> → '/Completion.ipynb
        // when the returned insert text is `Completion.ipynb` (the token here is `'/Com`)
        // developed against pyls and pylsp server, may not work well in other cases
        const parts = prefix.split('/');
        if (
          text.toLowerCase().startsWith(parts[parts.length - 1].toLowerCase())
        ) {
          let pathPrefix = parts.slice(0, -1).join('/') + '/';
          match.insertText = pathPrefix + match.insertText;
          // for label removing the prefix quote if present
          if (pathPrefix.startsWith("'") || pathPrefix.startsWith('"')) {
            pathPrefix = pathPrefix.substr(1);
          }
          match.label = pathPrefix + match.label;
          allNonPrefixed = false;
        }
      }

      const completionItem: CompletionHandler.ICompletionItem = {
        label: match.label,
        documentation: (match.documentation as string) ?? '',
        insertText: match.insertText ?? undefined
      };

      items.push(completionItem as any);
    });

    // required to make the repetitive trigger characters like :: or ::: work for R with R languageserver,
    // see https://github.com/jupyter-lsp/jupyterlab-lsp/issues/436
    let prefixOffset = token.value.length;
    // completion of dictionaries for Python with jedi-language-server was
    // causing an issue for dic['<tab>'] case; to avoid this let's make
    // sure that prefix.length >= prefix.offset
    if (allNonPrefixed && prefixOffset > prefix.length) {
      prefixOffset = prefix.length;
    }

    const response = {
      // note in the ContextCompleter it was:
      // start: token.offset,
      // end: token.offset + token.value.length,
      // which does not work with "from statistics import <tab>" as the last token ends at "t" of "import",
      // so the completer would append "mean" as "from statistics importmean" (without space!);
      // (in such a case the typedCharacters is undefined as we are out of range)
      // a different workaround would be to prepend the token.value prefix:
      // text = token.value + text;
      // but it did not work for "from statistics <tab>" and lead to "from statisticsimport" (no space)
      start: token.offset + (allNonPrefixed ? prefixOffset : 0),
      end: token.offset + prefix.length,
      items: items,
      source: {
        name: 'LSP',
        priority: 2
      }
    };
    if (response.start > response.end) {
      console.log(
        'Response contains start beyond end; this should not happen!',
        response
      );
    }

    return response;
  }

  identifier = 'CompletionProvider:lsp';
  renderer:
    | Completer.IRenderer<CompletionHandler.ICompletionItem>
    | null
    | undefined;
  private _manager: ILSPDocumentConnectionManager;
}

export namespace LspCompletionProvider {
  export interface IOptions {
    manager: ILSPDocumentConnectionManager;
  }
}
