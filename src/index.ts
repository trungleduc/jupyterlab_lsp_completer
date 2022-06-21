import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICompletionProviderManager } from '@jupyterlab/completer';
import {
  IFeature,
  ILSPDocumentConnectionManager,
  ILSPFeatureManager
} from '@jupyterlab/lsp';
import { LspCompletionProvider } from './lsp_provider';
/**
 * Initialization data for the jupyterlab_lsp_completer extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_lsp_completer:plugin',
  autoStart: true,
  requires: [ICompletionProviderManager],
  optional: [ILSPDocumentConnectionManager, ILSPFeatureManager],
  activate: activateCompleter
};

function activateCompleter(
  app: JupyterFrontEnd,
  providerManager: ICompletionProviderManager,
  lspManager?: ILSPDocumentConnectionManager,
  featureManager?: ILSPFeatureManager
): void {
  if (!lspManager || !featureManager) {
    return;
  }

  const feature: IFeature = {
    id: 'lsp-extension:completer',
    capabilities: {
      textDocument: {
        completion: {
          dynamicRegistration: true,
          completionItem: {
            snippetSupport: false,
            commitCharactersSupport: true,
            documentationFormat: ['markdown', 'plaintext'],
            deprecatedSupport: true,
            preselectSupport: false,
            tagSupport: {
              valueSet: [1]
            }
          },
          contextSupport: false
        }
      }
    }
  };

  featureManager.register(feature);
  const provider = new LspCompletionProvider({ manager: lspManager });
  providerManager.registerProvider(provider);
}

export default plugin;
