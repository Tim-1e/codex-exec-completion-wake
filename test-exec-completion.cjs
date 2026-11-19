'use strict';
const assert = require('node:assert/strict');
const {createCompletion} = require(process.argv[2] || './exec-completion.cjs');

async function check() {
  const calls = [];
  const jobs = new Map();
  const wake = createCompletion(async (method, p) => {
    calls.push([method, p]);
    if (method === 'thread/read') return {thread:{turns:[{items:jobs.get(p.threadId) || []}]}};
    return {queuedSubmission:{id:'receipt'}};
  });
  function command(threadId, id, method) {
    const item = {id:'exec-'+id, type:'commandExecution', source:'unifiedExecStartup',
      processId:String(id), status:method==='item/completed'?'completed':'inProgress',
      exitCode:method==='item/completed'?0:null, aggregatedOutput:'private command output'};
    if (method==='item/completed') jobs.set(threadId, [...(jobs.get(threadId) || []), item]);
    wake.observe({method,params:{threadId, turnId:'turn', item}});
  }
  const end = (threadId,status='completed') => wake.observe({method:'turn/completed',params:{threadId,turn:{id:'turn',status}}});
  const register = (threadId,id,turnId='turn') => wake.register({threadId,turnId,arguments:{session_id:id}});
  const read = (threadId,id) => wake.register({threadId,turnId:'next',arguments:{result_id:'exec-'+id}});
  const queues = () => calls.filter(([m]) => m==='thread/queue/add');
  for (const id of [1,2,3,4]) command('A',id,'item/started');
  for (const id of [1,2,4]) command('A',id,'item/completed');
  assert.match((await register('A',4)).contentItems[0].text,/already finished/);
  assert.equal((await register('B',3)).success,false);
  assert.equal((await register('A',3,'other')).success,false);
  assert.equal((await register('A',3)).success,true);
  end('A');
  command('A',3,'item/completed');
  command('A',3,'item/completed');
  end('A');
  assert.deepEqual(queues().map(([,p])=>p.threadId),['A']);
  assert.doesNotMatch(queues()[0][1].input[0].text,/private command output/);
  wake.clear('A');
  await new Promise(setImmediate);
  assert.equal(calls.at(-1)[0],'thread/queue/delete');
  assert.equal((await read('B',3)).success,false);
  assert.match((await read('A',3)).contentItems[0].text,/private command output/);
  command('C',5,'item/started');
  await register('C',5);
  command('C',5,'item/completed');
  assert.equal(queues().length,1);
  end('C');
  assert.equal(queues().length,2);
  command('D',6,'item/started');
  await register('D',6);
  end('D','interrupted');
  command('D',6,'item/completed');
  assert.equal(queues().length,2);
  console.log('Passed: four jobs with one wake, scoped registration and result retrieval, races, duplicate events and interruption.');
}
check().catch(error => {console.error(error);process.exitCode=1;});
