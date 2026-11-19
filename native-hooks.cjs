'use strict';
const { createCompletion, spec } = require('./exec-completion.cjs');

// Use one instance per native local app-server connection. request() must
// correlate IDs and resolve to the RPC result (or reject on error).
function createNativeHooks(request, warn) {
  const wake = createCompletion(request, warn);
  return {
    outgoing(message) {
      if (message.method === 'thread/start') {
        const tools = message.params?.dynamicTools ?? [];
        if (!tools.some(tool => tool.name === spec.name)) {
          return { ...message, params: { ...message.params, dynamicTools: [...tools, spec] } };
        }
      }
      if (['turn/interrupt', 'thread/archive', 'thread/delete'].includes(message.method)) {
        wake.clear(message.params?.threadId);
      }
      return message;
    },
    // Return true only when this adapter owns the server's request.
    incoming(message, sendResponse) {
      if (message.method === 'item/tool/call' && message.params?.tool === spec.name && !message.params.namespace) {
        wake.register(message.params).then(
          result => sendResponse({ id: message.id, result }),
          () => sendResponse({ id: message.id, result: { success: false, contentItems: [
            { type: 'inputText', text: 'Command result unavailable.' }
          ] } })
        );
        return true;
      }
      wake.observe(message);
      return false;
    }
  };
}
module.exports = { createNativeHooks };
