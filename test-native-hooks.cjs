'use strict';
const assert = require('node:assert/strict');
const {createNativeHooks} = require('./native-hooks.cjs');
const hooks = createNativeHooks(async () => { throw Error('unused RPC'); });
const start = hooks.outgoing({method:'thread/start', params:{dynamicTools:[{name:'existing'}]}});
assert.deepEqual(start.params.dynamicTools.map(t => t.name), ['existing','wake_on_exec_completion']);
assert.equal(hooks.outgoing(start),start);
assert.equal(hooks.incoming({method:'item/tool/call',params:{tool:'existing'}},()=>{}),false);
new Promise((resolve,reject) => {
  const timer=setTimeout(()=>reject(Error('missing response')),1000);
  const handled=hooks.incoming({id:42,method:'item/tool/call',params:{threadId:'A',turnId:'B',tool:'wake_on_exec_completion',arguments:{session_id:1}}},r=>{
    clearTimeout(timer); resolve(r);
  });
  assert.equal(handled,true);
}).then(r=>{assert.equal(r.id,42);assert.equal(r.result.success,false);console.log('PASS: native host hooks');}).catch(e=>{console.error(e);process.exitCode=1;});
