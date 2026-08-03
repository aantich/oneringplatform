import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InterviewWorkspace } from './InterviewWorkspace';
import type { Project } from '../types';

const project: Project = {
  id: 'test',
  name: 'Test app',
  description: 'Test',
  stage: 'discovery',
  readiness: 42,
  specVersion: 3,
  updatedAt: new Date().toISOString(),
  artifacts: [],
  prd: [{ id: 'goal', title: 'Goal', body: 'A confirmed product goal', status: 'confirmed' }],
  interview: [{ id: 'm1', role: 'assistant', content: 'What happens when approval is denied?', createdAt: new Date().toISOString() }],
};

describe('InterviewWorkspace', () => {
  it('shows the living PRD and sends a plain-language answer', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<InterviewWorkspace project={project} aiAvailable onSend={onSend} onApprove={vi.fn()} />);
    expect(screen.getByText('A confirmed product goal')).toBeInTheDocument();
    const input = screen.getByLabelText('Interview answer');
    fireEvent.change(input, { target: { value: 'A manager reviews it.' } });
    fireEvent.click(screen.getByRole('button', { name: /send answer/i }));
    expect(onSend).toHaveBeenCalledWith('A manager reviews it.');
  });
});
