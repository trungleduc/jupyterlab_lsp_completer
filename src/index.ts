import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Initialization data for the jupyterlab_lsp_completer extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_lsp_completer:plugin',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension jupyterlab_lsp_completer is activated!');
  }
};

export default plugin;
