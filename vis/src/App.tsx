import React, { useState, useCallback, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell, ComposedChart, Line } from 'recharts'
import { Activity, MessageSquare, Wrench, Clock, Database, Braces, Terminal, CheckCircle, XCircle, TrendingUp, Info, ChevronRight } from 'lucide-react'

type EventType = 'message.updated' | 'message.part.updated' | 'session.updated' | 'session.status' | 'message.part.delta' | string;

interface Event {
  type: EventType;
  properties: any;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

function App() {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'dashboard' | 'conversation' | 'raw'>('dashboard')
  const [selectedStep, setSelectedStep] = useState<any>(null)

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setSelectedStep(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split('\n').filter(l => l.trim() !== '');
        const parsedEvents = lines.map(line => JSON.parse(line));
        setEvents(parsedEvents);
      } catch (err) {
        console.error("Failed to parse JSONL", err);
        alert("Failed to parse file");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }, []);

  // Compute aggregated data
  const { messages, tokenChartData, toolChartData, toolErrorData, agentUsageData, ctxGrowthData, summaryStats } = useMemo(() => {
    if (events.length === 0) return { messages: [], tokenChartData: [], toolChartData: [], toolErrorData: [], agentUsageData: [], ctxGrowthData: [], summaryStats: null };

    const msgs: Record<string, any> = {};
    events.forEach(e => {
      if (e.type === 'message.part.updated' && e.properties.part?.type === 'step-finish') {
         const part = e.properties.part;
         if (msgs[part.messageID]) {
            msgs[part.messageID].tokens = part.tokens;
         }
      }

      if (e.type === 'message.updated') {
        const info = e.properties.info;
        if (!msgs[info.id]) msgs[info.id] = { ...info, parts: [] };
        else msgs[info.id] = { ...msgs[info.id], ...info };
      } else if (e.type === 'message.part.updated' && e.properties.part?.type !== 'step-finish') {
        const part = e.properties.part;
        if (msgs[part.messageID]) {
           const idx = msgs[part.messageID].parts.findIndex((p: any) => p.id === part.id);
           if (idx >= 0) msgs[part.messageID].parts[idx] = part;
           else msgs[part.messageID].parts.push(part);
        }
      }
    });

    const msgArray = Object.values(msgs).sort((a, b) => {
       const timeA = a.time?.created || 0;
       const timeB = b.time?.created || 0;
       return timeA - timeB;
    });

    let cumTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalReasoning = 0;
    let totalCached = 0;
    
    let prevContextSize = 0;
    let prevStepData: any = { tools: [], parts: [] };

    const tChartData: any[] = [];
    const cGrowthData: any[] = [];
    const toolCounts: Record<string, number> = {};
    let successfulTools = 0;
    let failedTools = 0;
    let totalTools = 0;
    const agentCounts: Record<string, number> = {};
    const countedCallIDs = new Set<string>();
    const finishedCallIDs = new Set<string>();

    msgArray.forEach((msg, index) => {
       const currentToolParts = msg.parts.filter((p: any) => p.type === 'tool' || p.type === 'tool_call');
       const uniqueTools = Array.from(new Set(currentToolParts.map((p: any) => p.tool || p.name)));
       const toolsLabel = uniqueTools.length > 0 ? uniqueTools.join(' & ') : 'LLM Text Output';

       if (msg.tokens && msg.tokens.total) {
          const inp = msg.tokens.input || 0;
          const out = msg.tokens.output || 0;
          const rsn = msg.tokens.reasoning || 0;
          const cacheRead = msg.tokens.cache?.read || 0;
          const actualContextSize = inp + cacheRead;

          if (actualContextSize > 0 || out > 0) {
             cumTokens += (actualContextSize + out);
             totalInput += inp;
             totalOutput += out;
             totalReasoning += rsn;
             totalCached += cacheRead;

             const stepName = `Step ${index + 1}`;
             tChartData.push({
                time: stepName,
                timestamp: msg.time?.created,
                inputTokens: inp,
                cachedTokens: cacheRead,
                actualContextSize: actualContextSize,
                outputTokens: out,
                reasoningTokens: rsn,
                cumulative: cumTokens
             });

             const delta = actualContextSize - prevContextSize;
             cGrowthData.push({
                name: stepName,
                growth: delta > 0 ? delta : 0,
                totalContext: actualContextSize,
                causedBy: prevStepData.label || "Initial User Prompt",
                // Attach the actual tool objects from the PREVIOUS step because they cause growth in CURRENT step
                sourceTools: prevStepData.parts 
             });

             prevContextSize = actualContextSize;
             prevStepData = { label: toolsLabel, parts: currentToolParts };
          }
       }

       if (msg.role === 'assistant' && msg.agent) {
           agentCounts[msg.agent] = (agentCounts[msg.agent] || 0) + 1;
       }

       msg.parts.forEach((p: any) => {
          if (p.type === 'tool' || p.type === 'tool_call') {
             const toolName = p.tool || p.name; 
             const callID = p.callID || p.id;
             
             if (toolName && callID && !countedCallIDs.has(callID)) {
                 toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
                 totalTools++;
                 countedCallIDs.add(callID);
             }

             if (callID && !finishedCallIDs.has(callID)) {
                 if (p.state?.status === 'completed' || (p.type === 'tool_result' && !p.error)) {
                    successfulTools++;
                    finishedCallIDs.add(callID);
                 } else if (p.state?.status === 'failed' || p.error) {
                    failedTools++;
                    finishedCallIDs.add(callID);
                 }
             }
          }
       });
    });

    const tlChartData = Object.keys(toolCounts).map(k => ({ name: k, count: toolCounts[k] })).sort((a,b) => b.count - a.count);
    const agentPieData = Object.keys(agentCounts).map(k => ({ name: k, value: agentCounts[k] }));
    const errorPieData = [
       { name: 'Success', value: successfulTools },
       { name: 'Failed/Rejected', value: failedTools }
    ];

    const startTime = msgArray.length > 0 ? msgArray[0].time?.created : 0;
    const endTime = msgArray.length > 0 ? msgArray[msgArray.length-1].time?.created || msgArray[msgArray.length-1].time?.completed : 0;
    const durationStr = (startTime && endTime) ? ((endTime - startTime) / 1000).toFixed(1) + 's' : '0s';

    return { 
       messages: msgArray, 
       tokenChartData: tChartData, 
       toolChartData: tlChartData,
       toolErrorData: errorPieData,
       agentUsageData: agentPieData,
       ctxGrowthData: cGrowthData,
       summaryStats: { cumTokens, totalInput, totalOutput, totalReasoning, totalCached, totalTools, durationStr, msgCount: msgArray.length }
    };
  }, [events]);

  const handleBarClick = (data: any) => {
    // Recharts passes the payload inside the first argument for Bars
    if (data && data.activePayload) {
       setSelectedStep(data.activePayload[0].payload);
    } else if (data && data.payload) {
       setSelectedStep(data.payload);
    } else {
       setSelectedStep(data);
    }
  };

  const GrowthTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 border border-gray-100 shadow-2xl rounded-xl z-50">
          <p className="font-bold text-gray-900 mb-3 border-b pb-2">{label}</p>
          <div className="space-y-2">
            <div className="flex justify-between gap-6 items-center">
              <span className="text-xs text-gray-500 uppercase font-bold tracking-tight">Cause of Growth</span> 
              <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded text-xs">{payload[0].payload.causedBy}</span>
            </div>
            <div className="flex justify-between gap-6 items-center">
              <span className="text-xs text-gray-500 uppercase font-bold tracking-tight">New Tokens</span> 
              <span className="font-bold text-rose-500">+{payload[0].payload.growth.toLocaleString()}</span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 italic text-center">Click bar to see tool details below</p>
          </div>
        </div>
      );
    }
    return null;
  };

  const renderDashboard = () => {
    if (!summaryStats) return null;

    return (
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-lg"><Activity size={24} /></div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Total Volume</p>
              <h3 className="text-2xl font-bold text-gray-900">{summaryStats.cumTokens.toLocaleString()}</h3>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
            <div className="p-3 bg-green-100 text-green-600 rounded-lg"><Database size={24} /></div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Billed Tokens</p>
              <h3 className="text-xl font-bold text-gray-900">{summaryStats.totalInput.toLocaleString()}</h3>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
            <div className="p-3 bg-cyan-100 text-cyan-600 rounded-lg"><Braces size={24} /></div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Cached Hits</p>
              <h3 className="text-xl font-bold text-gray-900">{summaryStats.totalCached.toLocaleString()}</h3>
            </div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
            <div className="p-3 bg-amber-100 text-amber-600 rounded-lg"><Wrench size={24} /></div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Tool Calls</p>
              <h3 className="text-2xl font-bold text-gray-900">{summaryStats.totalTools}</h3>
            </div>
          </div>
        </div>

        {/* Context Growth Section with Drill-down */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-2">
               <div className="flex items-center gap-2">
                  <TrendingUp className="text-rose-500" size={20} />
                  <h3 className="text-lg font-bold text-gray-800">Context Window Growth Breakdown</h3>
               </div>
            </div>
            <p className="text-sm text-gray-500 mb-6 font-medium">Click on a growth bar to inspect the specific tool execution that expanded the context window.</p>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
               {/* The Chart */}
               <div className="lg:col-span-2 h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={ctxGrowthData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{fontSize: 11}} />
                      <YAxis yAxisId="left" tick={{fontSize: 11}} orientation="left" />
                      <YAxis yAxisId="right" tick={{fontSize: 11}} orientation="right" />
                      <Tooltip content={<GrowthTooltip />} cursor={{fill: '#f1f5f9', fillOpacity: 0.5}} />
                      <Legend verticalAlign="top" height={36}/>
                      <Bar yAxisId="left" dataKey="growth" name="Context Growth (+Tokens)" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={50} onClick={handleBarClick} className="cursor-pointer" />
                      <Line yAxisId="right" type="monotone" dataKey="totalContext" name="Total Context Size" stroke="#6366f1" strokeWidth={3} dot={{r: 4, fill: '#fff', stroke: '#6366f1', strokeWidth: 2}} />
                    </ComposedChart>
                  </ResponsiveContainer>
               </div>

               {/* Drill-down Detail Panel */}
               <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 overflow-y-auto max-h-80">
                  <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2">
                     <Info size={16} className="text-slate-500" />
                     <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Tool Execution Detail</h4>
                  </div>
                  
                  {selectedStep ? (
                    <div className="space-y-4">
                       <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-500 uppercase">{selectedStep.name} Source</span>
                          <span className="text-xs font-bold text-rose-600">+{selectedStep.growth} tokens</span>
                       </div>
                       
                       {selectedStep.sourceTools && selectedStep.sourceTools.length > 0 ? (
                          selectedStep.sourceTools.map((t: any, idx: number) => (
                             <div key={idx} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                   <div className="p-1.5 bg-indigo-100 text-indigo-600 rounded">
                                      <Terminal size={12} />
                                   </div>
                                   <span className="font-bold text-slate-700 text-sm">{t.tool || t.name}</span>
                                </div>
                                <div className="space-y-2">
                                   <div>
                                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Input</p>
                                      <pre className="text-[10px] bg-slate-50 p-2 rounded text-slate-600 overflow-x-auto whitespace-pre-wrap">
                                         {JSON.stringify(t.state?.input || t.arguments, null, 2)}
                                      </pre>
                                   </div>
                                   <div>
                                      <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Output Size</p>
                                      <div className="text-[10px] font-medium text-slate-600 bg-emerald-50 border border-emerald-100 p-2 rounded flex justify-between items-center">
                                         <span>Execution Successful</span>
                                         <span className="text-emerald-700 font-bold">LEN: {(t.state?.output || t.output || t.state?.metadata?.output || "").length} chars</span>
                                      </div>
                                   </div>
                                </div>
                             </div>
                          ))
                       ) : (
                          <div className="text-center py-10 text-slate-400 text-xs italic leading-loose">
                             This step surge was caused by the LLM's own text response (no tool was called).
                          </div>
                       )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-3">
                       <Terminal size={32} className="opacity-20" />
                       <p className="text-xs text-center px-4">Click any red bar on the left to see the tools executed during that period.</p>
                    </div>
                  )}
               </div>
            </div>
        </div>

        {/* Secondary Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Token Usage Timeline (Stacked)</h3>
            <div className="h-72 w-full">
              {tokenChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={tokenChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorCached" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" tick={{fontSize: 11}} />
                    <YAxis tick={{fontSize: 11}} />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="cachedTokens" name="Cached Context" stroke="#06b6d4" fillOpacity={1} fill="url(#colorCached)" stackId="1" />
                    <Area type="monotone" dataKey="inputTokens" name="Billed Input" stroke="#6366f1" fillOpacity={1} fill="url(#colorInput)" stackId="1" />
                    <Area type="monotone" dataKey="outputTokens" name="Output" stroke="#10b981" fill="#10b981" fillOpacity={0.3} stackId="1" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">No token data available</div>
              )}
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Tool Success & Distribution</h3>
            <div className="h-64 w-full grid grid-cols-2">
               {/* Distribution Pie */}
               <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={toolChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="count" nameKey="name">
                      {toolChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '10px' }} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Success Pie */}
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={toolErrorData} cx="50%" cy="50%" innerRadius={40} outerRadius={60} paddingAngle={5} dataKey="value">
                      <Cell fill="#10b981" /> 
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '10px' }} />
                  </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="flex justify-around text-center mt-2">
               <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Usage Types</p>
                  <p className="text-xs font-semibold text-gray-600">{toolChartData.length} distinct tools</p>
               </div>
               <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Reliability</p>
                  <p className="text-xs font-semibold text-emerald-600">{((toolErrorData[0].value / (toolErrorData[0].value + toolErrorData[1].value || 1)) * 100).toFixed(0)}% success</p>
               </div>
            </div>
          </div>
          
        </div>
      </div>
    )
  }

  const renderConversation = () => {
    return (
      <div className="space-y-6">
        {messages.map(msg => (
          <div key={msg.id} className={`p-5 rounded-xl shadow-sm border border-gray-200 ${msg.role === 'user' ? 'bg-blue-50 ml-auto max-w-4xl' : 'bg-white max-w-5xl'}`}>
             <div className="flex justify-between items-center mb-3">
               <div className="font-bold text-xs text-gray-500 uppercase tracking-wider flex items-center gap-2">
                 {msg.role === 'user' ? <MessageSquare size={14} /> : <Terminal size={14} />}
                 {msg.role} {msg.agent ? <span className="text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded ml-1">Agent: {msg.agent}</span> : ''}
               </div>
               {msg.tokens && msg.tokens.total > 0 && (
                 <div className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded">
                   Tokens: {msg.tokens.input}in | {msg.tokens.cache?.read > 0 ? `+${msg.tokens.cache.read}cached | ` : ''} {msg.tokens.output}out {msg.tokens.reasoning > 0 && `| ${msg.tokens.reasoning}rsn`}
                 </div>
               )}
             </div>

             {msg.parts?.map((part: any, i: number) => {
                if (part.type === 'text') {
                  return <div key={i} className="mb-3 last:mb-0 whitespace-pre-wrap text-gray-800 leading-relaxed">{part.text}</div>
                }
                
                if (part.type === 'tool' || part.type === 'tool_call') {
                  const isFinished = part.state?.status === 'completed' || part.state?.status === 'failed' || part.type === 'tool_result';
                  const isError = part.state?.status === 'failed' || part.error;
                  const toolName = part.tool || part.name;
                  const toolArgs = part.state?.input || part.arguments;
                  const output = part.state?.output || part.state?.metadata?.output || part.output || "Done";

                  return (
                    <div key={i} className="mb-3 last:mb-0">
                       <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg text-sm mt-2 font-mono">
                          <div className="font-semibold flex items-center gap-2 text-slate-700 mb-2">
                            <Wrench size={14} />
                            {toolName}
                          </div>
                          <pre className="text-xs text-slate-600 overflow-x-auto">{JSON.stringify(toolArgs, null, 2)}</pre>
                       </div>
                       
                       {isFinished && (
                         <div className={`p-3 rounded-lg text-sm mt-1 border ${isError ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                            <div className={`font-semibold flex items-center gap-2 mb-2 text-xs uppercase ${isError ? 'text-red-700' : 'text-emerald-700'}`}>
                               {isError ? <><XCircle size={14} /> Error / Rejected</> : <><CheckCircle size={14} /> Result</>}
                            </div>
                            <pre className={`text-xs overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto ${isError ? 'text-red-800' : 'text-emerald-800'}`}>
                              {output}
                            </pre>
                         </div>
                       )}
                    </div>
                  )
                }

                return null;
             })}
          </div>
        ))}
      </div>
    )
  }

  const renderRawLogs = () => {
    return (
      <div className="space-y-4">
        {events.map((event, index) => (
          <div key={index} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-purple-100 text-purple-800 border border-purple-200">
                {event.type}
              </span>
              <span className="text-xs text-gray-500 font-mono">
                {event.properties?.time ? new Date(event.properties.time.created || event.properties.time).toLocaleString() : ''}
              </span>
            </div>
            <div className="text-xs text-gray-700 bg-gray-50 p-3 rounded overflow-x-auto border border-gray-100">
              <pre>{JSON.stringify(event.properties, null, 2)}</pre>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="min-h-screen p-8 max-w-7xl mx-auto">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            <Activity className="text-indigo-600" size={32} />
            Opencode Insight
          </h1>
          <p className="text-gray-500 mt-2 font-medium">Upload a session log to analyze internal metrics and agent behavior.</p>
        </div>
        <div className="w-full md:w-auto">
          <label className="block w-full cursor-pointer bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold py-3 px-6 rounded-xl border border-indigo-200 transition-colors text-center">
            <span>Choose JSONL File</span>
            <input 
              type="file" 
              accept=".jsonl" 
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </header>

      {loading && (
        <div className="text-center py-20 flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-gray-500 font-medium">Parsing session logs...</p>
        </div>
      )}

      {!loading && events.length > 0 && (
        <div>
          {/* Navigation Tabs */}
          <div className="flex space-x-1 bg-gray-200 p-1 rounded-xl mb-8 w-fit">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}
            >
              <Activity size={16} /> Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('conversation')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'conversation' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}
            >
              <MessageSquare size={16} /> Conversation
            </button>
            <button 
              onClick={() => setActiveTab('raw')}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${activeTab === 'raw' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-300'}`}
            >
              <Braces size={16} /> Raw Logs
            </button>
          </div>

          {/* Active View */}
          <div className="animate-in fade-in duration-300">
            {activeTab === 'dashboard' && renderDashboard()}
            {activeTab === 'conversation' && renderConversation()}
            {activeTab === 'raw' && renderRawLogs()}
          </div>
        </div>
      )}

      {!loading && events.length === 0 && (
        <div className="text-center py-32 bg-white rounded-3xl border-2 border-dashed border-gray-200">
           <Database className="mx-auto text-gray-300 mb-4" size={48} />
           <h3 className="text-lg font-medium text-gray-900">No data loaded</h3>
           <p className="text-gray-500 mt-1">Upload an opencode `.jsonl` session file to begin analysis.</p>
        </div>
      )}
    </div>
  )
}

export default App
