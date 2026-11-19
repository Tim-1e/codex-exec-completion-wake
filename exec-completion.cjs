'use strict';
const {randomUUID} = require('node:crypto');
const name = 'wake_on_exec_completion';
const spec = {
  type: 'function', name, deferLoading: false,
  description: 'For finite long commands, start exec_command with a short yield. If it returns a running session_id and later work depends on the result, register that session_id here in the same turn instead of polling write_stdin. After successful registration end the turn when only waiting. Desktop queues a continuation for this chat on exit. On wake, pass the result_id from the notice to read command output. Supply one argument at a time. Keep SSH attached to the remote command. Skip interactive commands and servers.',
  inputSchema: {type:'object',properties:{session_id:{type:'integer'},result_id:{type:'string'}},additionalProperties:false}
};
const reply = (success,text) => ({success,contentItems:[{type:'inputText',text}]});
function createCompletion(request, warn = () => {}) {
  const threads = new Map();
  const key = (turn, process) => turn + ':' + process;
  function clear(threadId) {
    const jobs = threads.get(threadId);
    threads.delete(threadId);
    if (!jobs) return;
    for (const job of jobs.values()) {
      job.cancelled = true;
      if (job.receipt) remove(threadId, job.receipt);
    }
  }
  function remove(threadId, queuedSubmissionId) {
    request('thread/queue/delete',{threadId,queuedSubmissionId}).catch(()=>warn('cancel_failed'));
  }
  function deliver(threadId, jobs, job) {
    if (!job.armed || !job.ended || !job.result || job.sent) return;
    job.sent = true;
    job.clientId = randomUUID();
    const text = 'Desktop background command finished. Call wake_on_exec_completion with ' +
      JSON.stringify({result_id:job.itemId}) + ' to read the result and continue the existing task.';
    request('thread/queue/add',{threadId,clientUserMessageId:job.clientId,input:[{type:'text',text,text_elements:[]}]}).then(r=>{
      job.receipt = r?.queuedSubmission?.id;
      if (job.cancelled && job.receipt) remove(threadId,job.receipt);
    }).catch(()=>{jobs.delete(job.key);warn('admission_unknown');});
  }
  function observe({method,params:p}) {
    if (!p?.threadId) return;
    const t = p.threadId;
    let jobs = threads.get(t);
    if (method==='thread/closed') {clear(t);return;}
    if (method==='turn/completed') {
      for (const job of jobs?.values() ?? []) if(job.turnId===p.turn.id) {
        if (!job.armed || p.turn.status!=='completed') jobs.delete(job.key);
        else {job.ended=true;deliver(t,jobs,job);}
      }
    } else if (method==='item/started' || method==='item/completed') {
      const i=p.item;
      if (i?.type==='userMessage' && i.clientId) {
        for (const job of jobs?.values() ?? []) if(job.clientId===i.clientId) jobs.delete(job.key);
      }
      if(i?.type==='commandExecution' && i.source==='unifiedExecStartup' && i.processId!=null && p.turnId) {
        const k=key(p.turnId,i.processId);
        if(method==='item/started') {
          if(!jobs) threads.set(t,jobs=new Map());
          if(!jobs.has(k)) jobs.set(k,{key:k,turnId:p.turnId,itemId:i.id});
        } else {
          const job=jobs?.get(k);
          if(job && job.itemId===i.id && (i.exitCode!=null || ['completed','failed','declined'].includes(i.status))) {
            job.result=true;
            deliver(t,jobs,job);
          }
        }
      }
    }
    if(jobs?.size===0) threads.delete(t);
  }
  async function register(p) {
    const args=p.arguments ?? {};
    if (typeof args.result_id==='string' && args.session_id===undefined) {
      const {thread}=await request('thread/read',{threadId:p.threadId,includeTurns:true});
      for (const turn of thread.turns) {
        const item=turn.items.find(i=>i.type==='commandExecution' && i.id===args.result_id);
        if (item) return reply(true, JSON.stringify({session_id:item.processId,status:item.status,exitCode:item.exitCode,outputTail:String(item.aggregatedOutput??'').slice(-4000)}));
      }
      return reply(false,'Command result unavailable in this chat.');
    }
    if (!Number.isSafeInteger(args.session_id) || args.result_id!==undefined) return reply(false,'Supply either session_id or result_id.');
    const job=threads.get(p.threadId)?.get(key(p.turnId,p.arguments?.session_id));
    if(!job) return reply(false,'No matching native exec in this chat and turn. Use normal exec result collection.');
    if(job.result && !job.armed) return reply(true,'Command already finished. Read it now with '+JSON.stringify({result_id:job.itemId}));
    job.armed=true;
    return reply(true,'Completion registered for this chat. End this turn now if only waiting for this result. Desktop will start the next turn when the command exits.');
  }
  return {observe,register,clear};
}
module.exports={createCompletion,spec};
