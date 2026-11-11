import React, { useCallback, useEffect, useRef, useState } from 'react';
import './style.css';
import './bold.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const NAV = [
  { id: 'overview', label: 'Overview', icon: 'â–¦' },
  { id: 'assistant', label: 'AI Assistant', icon: 'âœ³' },
  { id: 'conversations', label: 'Conversations', icon: 'â–¤' },
  { id: 'tickets', label: 'Human follow-up', icon: 'â—‡' },
  { id: 'knowledge', label: 'Knowledge base', icon: 'â–§' },
  { id: 'insights', label: 'AI insights', icon: 'âŒ' },
];

const KNOWLEDGE = [
  { title: 'Password Reset', detail: 'Password reset instructions and reset link validity.', tag: 'Account access' },
  { title: 'Two-Factor Authentication', detail: 'Supported authentication methods and security settings.', tag: 'Security' },
  { title: 'Subscription Cancellation', detail: 'Cancellation steps, billing periods, and refund review policy.', tag: 'Billing' },
];

function App() {
  const [page, setPage] = useState('overview');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [notice, setNotice] = useState('');
  const bottom = useRef(null);

  const loadData = useCallback(async () => {
    try {
      const [m, e, h] = await Promise.all([
        fetch(`${API}/api/admin/metrics`), fetch(`${API}/api/admin/evaluation`), fetch(`${API}/api/conversations`),
      ]);
      if (!m.ok || !e.ok || !h.ok) throw new Error('The support service returned an error.');
      const [metricsData, evaluationData, historyData] = await Promise.all([m.json(), e.json(), h.json()]);
      setMetrics(metricsData); setEvaluation(evaluationData); setHistory(historyData);
      setError('');
    } catch {
      setError('Could not connect to the support service. Check that the backend is running.');
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  async function openConversation(id) {
    try {
      const response = await fetch(`${API}/api/conversations/${id}`);
      if (!response.ok) throw new Error('Could not load this conversation.');
      const data = await response.json();
      setConversationId(id);
      setMessages(data.messages.map(m => ({
        role: m.role, content: m.role === 'user' ? m.content : undefined,
        answer: m.role === 'assistant' ? m.content : undefined, status: m.status,
        sources: m.sources, citations: m.citations, confidence: m.confidence,
        message_id: m.id, feedback: m.feedback,
      })));
      setPage('assistant'); setError(''); setNotice('');
    } catch (err) { setError(err.message); }
  }

  function newConversation() {
    setConversationId(null); setMessages([]); setInput(''); setError(''); setNotice(''); setPage('assistant');
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
          conversation: prior.slice(-8).map(m => ({ role: m.role, content: m.content || m.answer })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to contact the support service.');
      setConversationId(data.conversation_id);
      setMessages(current => [...current, { role: 'assistant', ...data }]);
      loadData();
    } catch (err) { setError(err.message || 'Something went wrong. Please try again.'); }
    finally { setLoading(false); }
  }

  async function sendFeedback(messageId, vote) {
    const response = await fetch(`${API}/api/messages/${messageId}/feedback`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote }),
    });
    if (response.ok) {
      setMessages(current => current.map(m => m.message_id === messageId ? { ...m, feedback: vote } : m));
      loadData();
    } else setError('Could not save feedback.');
  }

  async function requestHandoff() {
    if (!conversationId) return;
    const question = [...messages].reverse().find(m => m.role === 'user')?.content;
    const response = await fetch(`${API}/api/conversations/${conversationId}/escalations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }),
    });
    const data = await response.json();
    if (response.ok) { setNotice(`Added to the local follow-up queue. Ticket ${data.ticket_id}`); loadData(); }
    else setError(data.detail || 'Could not request follow-up.');
  }

  async function resetMetrics() {
    if (!window.confirm('Clear request metrics? Conversations, feedback, and follow-up tickets will be kept.')) return;
    const response = await fetch(`${API}/api/admin/metrics`, { method: 'DELETE' });
    if (response.ok) loadData(); else setError('Could not reset request metrics.');
  }

  const answered = metrics?.answered || 0;
  const total = metrics?.total || 0;
  const resolution = total ? Math.round(answered / total * 100) : 0;
  const title = NAV.find(item => item.id === page)?.label || 'Overview';
  const tickets = metrics?.escalations || [];

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage('overview')} aria-label="Support Agent Studio home">
        <span className="brand-mark">âœ³</span><span>Support Agent<span className="brand-light">Studio</span></span>
      </button>
      <div className="workspace-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {NAV.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setError(''); if (item.id === 'overview' || item.id === 'insights' || item.id === 'tickets') loadData(); }}>
          <span className="nav-icon">{item.icon}</span><span>{item.label}</span>
          {item.id === 'tickets' && tickets.length > 0 && <span className="nav-count">{tickets.length}</span>}
        </button>)}
      </nav>
      <div className="sidebar-bottom"><div className="environment"><span className="status-dot"/> Local workspace</div><div className="profile"><div className="profile-avatar">SA</div><div><strong>Support admin</strong><small>Administrator</small></div><span className="profile-more">Â·Â·Â·</span></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div><div className="eyebrow">SUPPORT OPERATIONS / {title.toUpperCase()}</div><h1>{page === 'overview' ? 'Support operations at a glance' : title}</h1></div>
        <div className="top-actions"><span className="service-state"><i className="status-dot"/> AI service connected</span><button className="button button-primary" onClick={newConversation}><span>ï¼‹</span> New conversation</button></div>
      </header>
      {error && <div className="global-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">Ã—</button></div>}
      {page === 'overview' && <Overview metrics={metrics} history={history} tickets={tickets} resolution={resolution} onOpenConversation={openConversation} onNavigate={setPage} evaluation={evaluation} />}
      {page === 'assistant' && <Assistant messages={messages} input={input} setInput={setInput} loading={loading} error={error} notice={notice} bottom={bottom} sendMessage={sendMessage} sendFeedback={sendFeedback} requestHandoff={requestHandoff} newConversation={newConversation} />}
      {page === 'conversations' && <ConversationList history={history} onOpen={openConversation} onNew={newConversation} />}
      {page === 'tickets' && <Tickets tickets={tickets} onOpenConversation={openConversation} />}
      {page === 'knowledge' && <Knowledge />}
      {page === 'insights' && <Insights metrics={metrics} evaluation={evaluation} resolution={resolution} onReset={resetMetrics} />}
    </main>
  </div>;
}

function Overview({ metrics, history, tickets, resolution, onOpenConversation, onNavigate, evaluation }) {
  const answered = metrics?.answered || 0;
  const total = metrics?.total || 0;
  const documents = Object.entries((metrics?.knowledge_usage || {}));
  return <section className="page-content overview-page">
    <div className="welcome-strip"><div><span className="welcome-kicker">SUPPORT TEAM OVERVIEW</span><h2>Deliver clearer, more helpful support.</h2><p>Review AI answers, follow customer conversations, and manage requests that need human attention.</p></div><button className="button button-white" onClick={() => onNavigate('assistant')}>Open AI assistant <span>â†—</span></button><div className="welcome-orb orb-one"/><div className="welcome-orb orb-two"/></div>
    <div className="stat-grid">
      <Stat label="Conversations" value={history.length} note="Saved customer conversations" icon="â–¤" tone="blue" />
      <Stat label="AI answer rate" value={`${resolution}%`} note={`${answered} requests answered by AI`} icon="âœ³" tone="teal" />
      <Stat label="Human follow-ups" value={tickets.length} note="Requests awaiting review" icon="â—‡" tone="amber" />
      <Stat label="Avg. response time" value={metrics?.avg_latency_ms == null ? 'â€”' : `${(metrics.avg_latency_ms / 1000).toFixed(1)}s`} note="Average model response time" icon="â—·" tone="violet" />
    </div>
    <div className="overview-grid">
      <section className="panel recent-panel"><PanelHeading title="Recent conversations" subtitle="Latest customer conversations" action="View all" onAction={() => onNavigate('conversations')} />
        {history.length ? <div className="conversation-table"><div className="table-head"><span>Conversation</span><span>Messages</span><span>Last updated</span></div>{history.slice(0, 5).map((item, i) => <button className="conversation-row" key={item.id} onClick={() => onOpenConversation(item.id)}><span className="customer-cell"><span className={`customer-avatar avatar-${i % 4}`}>{initials(item.title)}</span><span><strong>{item.title || 'Support conversation'}</strong><small>Support conversation</small></span></span><span className="table-number">{item.message_count}</span><span className="table-time">{timeAgo(item.updated_at)}</span></button>)}</div> : <Empty title="No conversations yet" text="Start a conversation to see support activity here." action="Open assistant" onAction={() => onNavigate('assistant')} />}
      </section>
      <section className="panel performance-panel"><PanelHeading title="AI performance" subtitle="How the assistant handled recent requests" action="View insights" onAction={() => onNavigate('insights')} />
        <div className="resolution-summary"><div className="ring" style={{ '--progress': `${resolution * 3.6}deg` }}><div><strong>{resolution}%</strong><small>answered</small></div></div><div className="resolution-copy"><strong>{answered} of {metrics?.total || 0} requests</strong><p>received an answer supported by the product documentation.</p><div className="legend-line"><i className="legend-teal"/> Answered <b>{answered}</b></div><div className="legend-line"><i className="legend-muted"/> Not found <b>{metrics?.not_found || 0}</b></div></div></div>
        <div className="panel-divider"/><div className="mini-stats"><div><small>Helpful feedback</small><strong>{metrics?.feedback?.helpful || 0}</strong></div><div><small>Tokens used</small><strong>{formatNumber(metrics?.total_tokens || 0)}</strong></div><div><small>Evaluation</small><strong className="eval-good">{evaluation ? `${evaluation.passed}/${evaluation.total}` : 'â€”'}</strong></div></div>
      </section>
      <section className="panel lower-panel"><PanelHeading title="Knowledge sources" subtitle="Product guidance used by the assistant" action="Browse" onAction={() => onNavigate('knowledge')} />
        <div className="source-list">{KNOWLEDGE.map((doc, i) => <div className="source-row" key={doc.title}><span className={`source-icon source-${i}`}>â–§</span><span className="source-text"><strong>{doc.title}</strong><small>{doc.tag}</small></span><span className="source-type">Active</span></div>)}</div>
      </section>
      <section className="panel lower-panel activity-panel"><PanelHeading title="Follow-up queue" subtitle="Requests awaiting human review" action="View queue" onAction={() => onNavigate('tickets')} />
        {tickets.length ? tickets.slice(0, 4).map(ticket => <div className="ticket-row" key={ticket.id}><span className="ticket-priority"/><span><strong>{ticket.question}</strong><small>{timeAgo(ticket.created_at)}</small></span><span className={`pill ${ticket.status === 'resolved' ? 'pill-green' : 'pill-amber'}`}>{ticket.status}</span></div>) : <div className="queue-empty"><span className="queue-check">âœ“</span><div><strong>No requests need review</strong><small>New human follow-up requests will appear here.</small></div></div>}
      </section>
    </div>
  </section>;
}

function Assistant({ messages, input, setInput, loading, error, notice, bottom, sendMessage, sendFeedback, requestHandoff, newConversation }) {
  return <section className="page-content assistant-page"><div className="assistant-layout"><div className="assistant-main panel">
    <div className="assistant-heading"><div className="agent-avatar">âœ³</div><div><strong>Support AI</strong><small><i className="status-dot"/> Grounded in your product knowledge</small></div><button className="button button-quiet" onClick={newConversation}>ï¼‹ New chat</button></div>
    <div className="chat-stream">
      {!messages.length && <div className="assistant-welcome"><div className="welcome-icon">âœ³</div><h2>What can I help you with?</h2><p>Ask about account access, security, or subscriptions. When the documentation supports an answer, the assistant will cite its source.</p><div className="suggestion-list">{['How do I reset my password?', 'Does the product support SMS authentication?', 'Will I receive a refund when I cancel?'].map(q => <button key={q} onClick={() => sendMessage(null, q)}>{q}<span>â†—</span></button>)}</div></div>}
      {messages.map((m, i) => <div className={`chat-message ${m.role}`} key={m.message_id || i}><div className={`chat-avatar ${m.role}`}>{m.role === 'user' ? 'You' : 'âœ³'}</div><div className="chat-body"><div className="chat-name">{m.role === 'user' ? 'You' : 'Support AI'} <small>{m.role === 'assistant' ? 'AI assistant' : ''}</small></div><div className="chat-bubble"><p>{m.content || m.answer}</p></div>{m.role === 'assistant' && <>
        <span className={`answer-state ${m.status}`}>{m.status === 'answered' ? 'âœ“ Answer grounded in knowledge' : 'â“˜ No supporting information found'}</span>
        {m.citations?.length > 0 && <div className="citation-list"><strong>Source evidence</strong>{m.citations.map((citation, n) => <article className="citation-card" key={`${citation.title}-${n}`}><div><b>{citation.title}</b><span>{Math.round(citation.relevance * 100)}% match</span></div><p>{citation.passage}</p></article>)}<small>Retrieval match reflects text relevance; it is not answer correctness.</small></div>}
        {m.message_id && <div className="feedback-line"><span>Was this helpful?</span><button disabled={!!m.feedback} className={m.feedback === 'helpful' ? 'selected' : ''} onClick={() => sendFeedback(m.message_id, 'helpful')} aria-label="Helpful">Helpful</button><button disabled={!!m.feedback} className={m.feedback === 'not_helpful' ? 'selected' : ''} onClick={() => sendFeedback(m.message_id, 'not_helpful')} aria-label="Not helpful">Not helpful</button></div>}
        {m.status === 'not_found' && <button className="button button-quiet handoff-button" onClick={requestHandoff}>Request human follow-up</button>}
      </>}</div></div>)}
      {loading && <div className="chat-message assistant"><div className="chat-avatar assistant">âœ³</div><div className="chat-body"><div className="chat-name">Support AI</div><div className="chat-bubble"><p className="typing">Searching knowledge and preparing an answerâ€¦</p></div></div></div>}
      {notice && <div className="inline-success">{notice}</div>}{error && <div className="inline-error">{error}</div>}<div ref={bottom}/>
    </div>
    <form className="chat-composer" onSubmit={sendMessage}><input value={input} onChange={e => setInput(e.target.value)} placeholder="Type your support questionâ€¦" maxLength={4000}/><button disabled={!input.trim() || loading}>Send <span>â†‘</span></button></form><div className="assistant-footnote">Responses are based on the product documentation available in this workspace.</div>
  </div><aside className="assistant-aside"><div className="panel context-panel"><span className="side-label">ASSISTANT STATUS</span><div className="status-card"><span className="status-icon">âœ“</span><div><strong>Ready to help</strong><small>Knowledge search is available</small></div></div><div className="panel-divider"/><span className="side-label">CONNECTED SOURCES</span>{KNOWLEDGE.map(doc => <div className="context-doc" key={doc.title}><span>â–§</span><strong>{doc.title}</strong></div>)}</div><div className="trust-note"><span>âœ§</span><div><strong>Answers cite their sources</strong><p>Supported answers include the exact passage used and its retrieval match.</p></div></div></aside></div></section>;
}

function ConversationList({ history, onOpen, onNew }) {
  return <section className="page-content"><div className="section-intro"><div><h2>Conversation history</h2><p>Browse previous customer conversations and continue where they left off.</p></div><button className="button button-primary" onClick={onNew}>ï¼‹ New conversation</button></div><div className="panel list-panel">{history.length ? history.map((item, i) => <button className="history-row" key={item.id} onClick={() => onOpen(item.id)}><span className={`customer-avatar avatar-${i % 4}`}>{initials(item.title)}</span><span className="history-title"><strong>{item.title || 'Support conversation'}</strong><small>{item.message_count} messages Â· Updated {timeAgo(item.updated_at)}</small></span><span className="history-open">Open conversation <b>â†—</b></span></button>) : <Empty title="No conversations yet" text="Start a conversation with the assistant to see it here." action="Start a conversation" onAction={onNew} />}</div></section>;
}

function Tickets({ tickets, onOpenConversation }) {
  return <section className="page-content"><div className="section-intro"><div><h2>Human follow-up queue</h2><p>Requests that need a support agentâ€™s review.</p></div><span className="queue-count">{tickets.length} recent {tickets.length === 1 ? 'request' : 'requests'}</span></div><div className="panel list-panel">{tickets.length ? tickets.map(ticket => <article className="ticket-detail" key={ticket.id}><span className="ticket-priority"/><div className="ticket-detail-copy"><div><strong>{ticket.question}</strong><span className={`pill ${ticket.status === 'resolved' ? 'pill-green' : 'pill-amber'}`}>{ticket.status}</span></div><small>Created {new Date(ticket.created_at).toLocaleString()} Â· Ticket {ticket.id.slice(0, 8)}</small><p>Open the conversation to review the full customer and assistant history.</p></div><button className="button button-quiet" onClick={() => onOpenConversation(ticket.conversation_id)}>View conversation</button></article>) : <Empty title="No follow-up requests" text="Requests will appear here when a customer asks for human help." />}</div><p className="page-note">Requests are stored in this local workspace. No external support platform is connected.</p></section>;
}

function Knowledge() {
  return <section className="page-content"><div className="section-intro"><div><h2>Knowledge base</h2><p>Product guidance the assistant can use when answering questions.</p></div><span className="knowledge-count">{KNOWLEDGE.length} active sources</span></div><div className="knowledge-grid">{KNOWLEDGE.map((doc, i) => <article className="panel knowledge-card" key={doc.title}><div className={`knowledge-icon source-${i}`}>â–§</div><span className="knowledge-category">{doc.tag}</span><h3>{doc.title}</h3><p>{doc.detail}</p><div className="knowledge-card-footer"><span><i className="status-dot"/> Active source</span><span>Built-in article</span></div></article>)}</div><div className="knowledge-callout"><span>i</span><p>This workspace searches three built-in documents by matching relevant terms. Document uploads and semantic vector search are not enabled.</p></div></section>;
}

function Insights({ metrics, evaluation, resolution, onReset }) {
  const max = Math.max(metrics?.answered || 0, metrics?.not_found || 0, metrics?.failures || 0, 1);
  return <section className="page-content"><div className="section-intro"><div><h2>AI insights</h2><p>Request outcomes, usage, customer feedback, and deterministic checks.</p></div><button className="button button-quiet" onClick={onReset}>Reset request metrics</button></div><div className="insight-grid">
    <div className="panel insight-card"><span className="card-label">TOTAL REQUESTS</span><strong className="insight-number">{metrics?.total || 0}</strong><small>Since the last metrics reset</small><div className="bar-chart"><div><span>Answered</span><i><b style={{ width: `${(metrics?.answered || 0) / max * 100}%` }}/></i><strong>{metrics?.answered || 0}</strong></div><div><span>Not found</span><i><b className="bar-amber" style={{ width: `${(metrics?.not_found || 0) / max * 100}%` }}/></i><strong>{metrics?.not_found || 0}</strong></div><div><span>Failures</span><i><b className="bar-red" style={{ width: `${(metrics?.failures || 0) / max * 100}%` }}/></i><strong>{metrics?.failures || 0}</strong></div></div></div>
    <div className="panel insight-card"><span className="card-label">AI ANSWER RATE</span><strong className="insight-number">{resolution}%</strong><small>Requests with an answer divided by all requests</small><div className="progress-track"><span style={{ width: `${resolution}%` }}/></div><p className="insight-caption">{metrics?.answered || 0} answered Â· {metrics?.not_found || 0} not found Â· {metrics?.failures || 0} failures</p></div>
    <div className="panel insight-card"><span className="card-label">MODEL USAGE</span><strong className="insight-number">{formatNumber(metrics?.total_tokens || 0)} <small>tokens</small></strong><div className="usage-pairs"><div><small>Avg. response time</small><strong>{metrics?.avg_latency_ms == null ? 'â€”' : `${Math.round(metrics.avg_latency_ms)} ms`}</strong></div><div><small>Estimated API cost</small><strong>{metrics?.cost_configured ? `$${Number(metrics.estimated_cost_usd || 0).toFixed(4)}` : 'Not configured'}</strong></div></div></div>
    <div className="panel insight-card"><span className="card-label">CUSTOMER FEEDBACK</span><strong className="insight-number">{(metrics?.feedback?.helpful || 0) + (metrics?.feedback?.not_helpful || 0)}</strong><small>Feedback submitted on assistant answers</small><div className="feedback-summary"><span>Helpful <b>{metrics?.feedback?.helpful || 0}</b></span><span>Not helpful <b>{metrics?.feedback?.not_helpful || 0}</b></span></div></div>
  </div><section className="panel evaluation-panel"><PanelHeading title="Retrieval and safety evaluation" subtitle="Curated deterministic checks against the built-in knowledge set" action={evaluation ? `${evaluation.passed}/${evaluation.total} passed` : 'Loading'} /><p className="evaluation-disclaimer">These checks verify document retrieval and prompt-injection handling. They do not score every live model response.</p>{evaluation?.cases?.map(test => <div className="eval-case" key={test.name}><span className={`eval-indicator ${test.passed ? 'pass' : 'fail'}`}>{test.passed ? 'âœ“' : '!'}</span><strong>{test.name.replaceAll('_', ' ')}</strong><span>{test.passed ? 'Passed' : 'Needs review'}</span></div>)}</section><p className="page-note">Metrics cover local demo traffic. Configure INPUT_COST_PER_1M and OUTPUT_COST_PER_1M in the backend environment to estimate spend.</p></section>;
}

function Stat({ label, value, note, icon, tone }) { return <article className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small><span className={`stat-spark ${tone}`}>âŒ</span></article>; }
function PanelHeading({ title, subtitle, action, onAction }) { return <div className="panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div>{action && <button onClick={onAction}>{action}<span>â†—</span></button>}</div>; }
function Empty({ title, text, action, onAction }) { return <div className="empty-state"><span>â–¤</span><strong>{title}</strong><p>{text}</p>{action && <button className="button button-quiet" onClick={onAction}>{action}</button>}</div>; }
function initials(title = '') { return title.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join('') || 'S'; }
function timeAgo(value) { const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); if (mins < 1) return 'Just now'; if (mins < 60) return `${mins}m ago`; if (mins < 1440) return `${Math.floor(mins / 60)}h ago`; return `${Math.floor(mins / 1440)}d ago`; }
function formatNumber(value) { return new Intl.NumberFormat().format(value); }

export default App;

