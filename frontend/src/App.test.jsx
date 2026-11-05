import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function answeredResponse(answer = 'The reset link is valid for 30 minutes.') {
  return {
    ok: true,
    json: async () => ({
      answer,
      status: 'answered',
      sources: ['Password Reset'],
      confidence: 0.9,
      conversation_id: 'conversation-1',
      message_id: 'message-1',
      citations: [{ title: 'Password Reset', passage: 'The reset link remains valid for 30 minutes.', relevance: 0.83 }],
    }),
  };
}

describe('Support Assistant chat', () => {
  it('renders the chat prompt, composer, and disabled clear-chat control', () => {
    render(<App />);

    expect(screen.getByText('How can I help?')).toBeTruthy();
    expect(screen.getByPlaceholderText('Ask a support question…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete conversation' }).disabled).toBe(true);
  });

  it('sends a suggested question and renders the sourced answer', async () => {
    fetch.mockResolvedValue(answeredResponse());
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /How do I reset my password/ }));

    expect(await screen.findByText('The reset link is valid for 30 minutes.')).toBeTruthy();
    expect(screen.getByText('1. Password Reset')).toBeTruthy();
    expect(screen.getByText('Retrieval match 83%')).toBeTruthy();
    expect(screen.getByText(/not answer confidence or correctness/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the loading indicator while a request is pending', async () => {
    let resolveFetch;
    fetch.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /How do I reset my password/ }));
    expect(await screen.findByText('Searching documentation and preparing an answer…')).toBeTruthy();
    resolveFetch(answeredResponse());
    expect(await screen.findByText('The reset link is valid for 30 minutes.')).toBeTruthy();
  });

  it('shows the not-found status for unsupported answers', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        answer: 'I could not find this information in the available product documentation.',
        status: 'not_found',
        sources: [],
        confidence: 0.15,
      }),
    });
    render(<App />);
    const input = screen.getByPlaceholderText('Ask a support question…');
    fireEvent.change(input, { target: { value: 'Can I log in using Google?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    expect(await screen.findByText(/Information not found/)).toBeTruthy();
  });

  it('displays API errors to the user', async () => {
    fetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'The AI service timed out. Please try again.' }),
    });
    render(<App />);
    const input = screen.getByPlaceholderText('Ask a support question…');
    fireEvent.change(input, { target: { value: 'How do I reset my password?' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    expect(await screen.findByText(/The AI service timed out\. Please try again\./)).toBeTruthy();
  });

  it('deletes the current conversation after confirmation', async () => {
    fetch.mockResolvedValue(answeredResponse());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /How do I reset my password/ }));
    expect(await screen.findByText('The reset link is valid for 30 minutes.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete this conversation?');
    await waitFor(() => expect(screen.getByText('How can I help?')).toBeTruthy());
    expect(screen.queryByText('The reset link is valid for 30 minutes.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete conversation' }).disabled).toBe(true);
  });

  it('keeps the conversation when deletion is canceled', async () => {
    window.confirm.mockReturnValue(false);
    fetch.mockResolvedValue(answeredResponse());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /How do I reset my password/ }));
    expect(await screen.findByText('The reset link is valid for 30 minutes.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));

    expect(screen.getByText('The reset link is valid for 30 minutes.')).toBeTruthy();
  });
});
