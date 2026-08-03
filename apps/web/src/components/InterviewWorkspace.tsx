import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Send, Sparkles } from 'lucide-react';
import type { Project } from '../types';

export function InterviewWorkspace({
  project,
  aiAvailable,
  onSend,
  onApprove,
}: {
  project: Project;
  aiAvailable: boolean;
  onSend: (message: string) => Promise<void>;
  onApprove: () => Promise<void>;
}) {
  const [message, setMessage] = useState('Escalate to the manager first, then show approved contractors if no internal option is available.');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [project.interview.length]);

  const submit = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await onSend(message);
      setMessage('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="interview-layout">
      <section className="interview-chat panel-card">
        <div className="panel-heading">
          <div>
            <div className="eyebrow"><Sparkles size={13} /> oneringai discovery agent</div>
            <h2>A careful conversation, not a questionnaire</h2>
          </div>
          <span className={`live-chip ${aiAvailable ? '' : 'live-chip--muted'}`}>
            <span /> {aiAvailable ? 'LLM connected' : 'Safe local mode'}
          </span>
        </div>
        <div className="chat-thread">
          <div className="chat-date">Today · PRD version {project.specVersion}</div>
          {project.interview.map((entry) => (
            <div key={entry.id} className={`chat-message chat-message--${entry.role}`}>
              {entry.role === 'assistant' && <div className="agent-avatar"><Sparkles size={15} /></div>}
              <div>
                <span>{entry.role === 'assistant' ? 'Discovery lead' : 'You'}</span>
                <p>{entry.content}</p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="composer">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Answer in your own words…"
            aria-label="Interview answer"
          />
          <button className="primary-button composer__send" disabled={!message.trim() || sending} onClick={() => void submit()}>
            {sending ? <span className="spinner" /> : <Send size={16} />}
            {sending ? 'Thinking…' : 'Send answer'}
          </button>
          <small>Enter to send · Shift + Enter for a new line</small>
        </div>
      </section>

      <section className="prd-panel panel-card">
        <div className="panel-heading">
          <div>
            <div className="eyebrow">Living source of truth</div>
            <h2>Product requirements</h2>
          </div>
          <span className="version-chip">v{project.specVersion}</span>
        </div>
        <div className="prd-progress">
          <div><span style={{ width: `${project.readiness}%` }} /></div>
          <strong>{project.readiness}% resolved</strong>
        </div>
        <div className="prd-sections">
          {project.prd.map((section, index) => (
            <article key={section.id} className="prd-section">
              <div className={section.status === 'confirmed' ? 'section-index section-index--done' : 'section-index'}>
                {section.status === 'confirmed' ? <Check size={14} /> : index + 1}
              </div>
              <div>
                <div className="prd-section__title">
                  <h3>{section.title}</h3>
                  {section.status === 'draft' && <span className="needs-input"><CircleAlert size={12} /> needs review</span>}
                </div>
                <p>{section.body}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="prd-footer">
          <p>Approval locks this PRD version for design. Future changes create a traceable new version.</p>
          <button className="secondary-button" onClick={() => void onApprove()}><Check size={16} /> Approve current PRD</button>
        </div>
      </section>
    </div>
  );
}
