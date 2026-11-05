import React, { useEffect, useRef, useState } from 'react';
import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState('chat');
  const [metrics, setMetrics] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [notice, setNotice] = useState('');
  const bottom = useRef(null);

  async function refreshHistory() {
    try { const r = await fetch(`${API}/api/conversations`); if (r.ok) setHistory(await r.json()); } catch { /* optional until backend is reachable */ }
  }
  useEffect(() => { refreshHistory(); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function openDashboard() {
    setView('dashboard');
    try {
      const [m, e] = await Promise.all([fetch(`${API}/api/admin/metrics`), fetch(`${API}/api/admin/evaluation`)]);
      if (m.ok) setMetrics(await m.json());
      if (e.ok) setEvaluation(await e.json());
    } catch { setError('Could not load dashboard metrics.'); }
  }

  async function resetMetrics() {
    if (!window.confirm('Clear development request metrics? Saved conversations, feedback, and follow-up tickets will be kept.')) return;
    const response = await fetch(`${API}/api/admin/metrics`, { method: 'DELETE' });
    if (!response.ok) { setError('Could not reset dashboard metrics.'); return; }
    setMetrics(await (await fetch(`${API}/api/admin/metrics`)).json());
  }

  async function openConversation(id) {
    try {
      const response = await fetch(`${API}/api/conversations/${id}`);
      if (!response.ok) throw new Error('Could not load this conversation.');
      const data = await response.json();
      setConversationId(id);
      setMessages(data.messages.map(m => ({
        role: m.role, content: m.role === 'user' ? m.content : undefined,
        answer: m.role === 'assistant' ? m.content : undefined,
        status: m.status, sources: m.sources, citations: m.citations, confidence: m.confidence,
        message_id: m.id, feedback: m.feedback,
      })));
      setView('chat'); setError(''); setNotice('');
    } catch (err) { setError(err.message); }
  }

  async function clearConversation() {
    if (!messages.length || loading) return;
    if (!window.confirm('Delete this conversation?')) return;
    if (conversationId) {
      const response = await fetch(`${API}/api/conversations/${conversationId}`, { method: 'DELETE' });
      if (!response.ok) { setError('Could not delete this conversation.'); return; }
    }
    setMessages([]); setInput(''); setError(''); setNotice(''); setConversationId(null); refreshHistory();
  }

  async function sendMessage(e, suggestedMessage) {
    e?.preventDefault();
    const message = (suggestedMessage ?? input).trim();
    if (!message || loading) return;
    const prior = messages;
    setMessages([...prior, { role: 'user', content: message }]);
    setInput(''); setError(''); setNotice(''); setLoading(true);
    try {
      const response = await fetch(`${API}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversation_id: conversationId,
          conversation: prior.slice(-8).map(m => ({ role: m.role, content: m.content || m.answer })) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to contact the support service.');
      setConversationId(data.conversation_id);
      setMessages(current => [...current, { role: 'assistant', ...data }]);
      refreshHistory();
    } catch (err) { setError(err.message || 'Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  }

  async function sendFeedback(messageId, vote) {
    const response = await fetch(`${API}/api/messages/${messageId}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote })
    });
    if (response.ok) setMessages(current => current.map(m => m.message_id === messageId ? { ...m, feedback: vote } : m));
    else setError('Could not save feedback.');
  }

  async function requestHandoff() {
    if (!conversationId) return;
    const question = [...messages].reverse().find(m => m.role === 'user')?.content;
    const response = await fetch(`${API}/api/conversations/${conversationId}/escalations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question })
    });
    const data = await response.json();
    if (response.ok) setNotice(`Added to the local support queue. Ticket ${data.ticket_id}`);
    else setError(data.detail || 'Could not request follow-up.');
  }

  return <main className="shell">
    <header><div className="logo">✦</div><div className="brand"><h1>Support Assistant</h1><p>Product help, grounded in official documentation</p></div><span className="online">● Online</span>
      <button type="button" className="header-action" onClick={() => { setView('history'); refreshHistory(); }}>History</button>
      <button type="button" className="header-action" onClick={openDashboard}>AI dashboard</button>
      <button type="button" className="clear-chat" onClick={clearConversation} disabled={!messages.length || loading} aria-label="Delete conversation" title="Delete conversation">Delete</button>
    </header>
    {view === 'dashboard' ? <section className="dashboard">
      <div className="dashboard-heading"><div><h2>AI performance</h2><p>Local evaluation and usage metrics</p></div><div className="dashboard-controls"><button className="header-action" onClick={resetMetrics}>Reset demo metrics</button><button className="header-action" onClick={() => setView('chat')}>Back to chat</button></div></div>
      <div className="metric-grid">
        <Metric label="Questions" value={metrics?.total ?? '—'} />
        <Metric label="Answered" value={metrics?.answered ?? 0} />
        <Metric label="Not found" value={metrics?.not_found ?? 0} />
        <Metric label="Failures" value={metrics?.failures ?? 0} />
        <Metric label="Avg latency" value={metrics?.avg_latency_ms == null ? '—' : `${Math.round(metrics.avg_latency_ms)} ms`} />
        <Metric label="Tokens" value={metrics?.total_tokens ?? '—'} />
        <Metric label="Estimated cost" value={!metrics?.cost_configured ? 'Not configured' : `$${Number(metrics?.estimated_cost_usd || 0).toFixed(4)}`} />
        <Metric label="Helpful votes" value={metrics?.feedback?.helpful ?? 0} />
      </div>
      <div className="dashboard-panel"><h3>Automated retrieval and safety evaluation</h3><p>{evaluation ? `${evaluation.passed}/${evaluation.total} curated checks passed (${Math.round(evaluation.pass_rate * 100)}%)` : 'Loading evaluation…'}</p><p className="eval-disclaimer">These deterministic cases check retrieval and prompt-injection handling. They do not evaluate every live model answer.</p>
        {evaluation?.cases.map(test => <div className="eval-row" key={test.name}><span>{test.name.replaceAll('_', ' ')}</span><b className={test.passed ? 'pass' : 'fail'}>{test.passed ? 'PASS' : 'FAIL'}</b></div>)}
      </div>
      <div className="dashboard-panel"><h3>Human follow-up requests</h3>{metrics?.escalations?.length ? metrics.escalations.map(ticket => <div className="eval-row" key={ticket.id}><span>{ticket.question}</span><b>{ticket.status}</b></div>) : <p>No open requests.</p>}</div>
      <p className="muted-note">Request metrics include development traffic since the last reset. Estimated cost appears after token rates are configured with INPUT_COST_PER_1M and OUTPUT_COST_PER_1M.</p>
    </section> : view === 'history' ? <section className="history-view"><div className="dashboard-heading"><div><h2>Conversation history</h2><p>Saved on this server</p></div><button className="header-action" onClick={() => { setConversationId(null); setMessages([]); setView('chat'); }}>New chat</button></div>
      {history.length ? history.map(item => <button className="history-item" key={item.id} onClick={() => openConversation(item.id)}><span>{item.title}</span><small>{item.message_count} messages · {new Date(item.updated_at).toLocaleString()}</small></button>) : <p>No saved conversations yet.</p>}
    </section> : <>
      <section className="chat">
        {messages.length === 0 && <div className="welcome"><div className="spark">✦</div><h2>How can I help?</h2><p>Ask a question about passwords, security, or subscriptions.</p><div className="suggestions">{['How do I reset my password?', 'Does the product support SMS authentication?', 'Will I receive a refund when I cancel?'].map(q => <button key={q} onClick={() => sendMessage(null, q)}>{q} ↗</button>)}</div></div>}
        {messages.map((m, i) => <div className={`message ${m.role}`} key={m.message_id || i}><div className="avatar">{m.role === 'user' ? 'Y' : '✦'}</div><div className="bubble"><div className="role">{m.role === 'user' ? 'You' : 'Support Assistant'}</div><p>{m.content || m.answer}</p>{m.role === 'assistant' && <>
          <div className={`status ${m.status}`}>{m.status === 'answered' ? '✓ Answer found' : 'ⓘ Information not found'}</div>
          {m.citations?.length > 0 && <div className="citations"><strong>Sources and evidence</strong>{m.citations.map((citation, n) => <div className="citation" key={`${citation.title}-${n}`}><b>{n + 1}. {citation.title}</b><span>Retrieval match {Math.round(citation.relevance * 100)}%</span><p>{citation.passage}</p></div>)}<small className="score-note">Lexical retrieval match score; it is not answer confidence or correctness.</small></div>}
          {m.message_id && <div className="message-actions"><span>Was this answer helpful?</span><button onClick={() => sendFeedback(m.message_id, 'helpful')} disabled={!!m.feedback} aria-label="Helpful">👍</button><button onClick={() => sendFeedback(m.message_id, 'not_helpful')} disabled={!!m.feedback} aria-label="Not helpful">👎</button>{m.feedback && <small>Feedback saved</small>}</div>}
          {m.status === 'not_found' && <button className="handoff" onClick={requestHandoff}>Request human follow-up</button>}
        </>}</div></div>)}
        {loading && <div className="message assistant"><div className="avatar">✦</div><div className="bubble"><div className="role">Support Assistant</div><p className="typing">Searching documentation and preparing an answer…</p></div></div>}
        {notice && <div className="success-note">{notice}</div>}{error && <div className="error">⚠ {error}</div>}<div ref={bottom}/>
      </section>
      <form onSubmit={sendMessage} className="composer"><input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask a support question…" maxLength={4000}/><button disabled={!input.trim() || loading}>{loading ? '…' : 'Send ↑'}</button></form>
      <footer>AI-generated answers are limited to the supplied product documentation.</footer>
    </>}
  </main>;
}

function Metric({ label, value }) { return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>; }
export default App;
