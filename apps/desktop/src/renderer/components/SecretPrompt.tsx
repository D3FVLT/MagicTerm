import { useEffect, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

export interface SecretRequest {
  title: string;
  /** Who asks and why, in a sentence. */
  description: string;
  /** Shown in red above the field, e.g. after a rejected password. */
  error?: string;
  submitLabel: string;
  /** false for a user name, which may be shown as typed. Default true. */
  secret?: boolean;
}

/**
 * Asks for a password or token for one use. What is typed goes to the caller and is not
 * kept here; the field is cleared when the prompt closes.
 */
export function SecretPrompt({ request, onAnswer }: { request: SecretRequest | null; onAnswer: (value: string | null) => void }) {
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue('');
  }, [request]);
  return (
    <Modal isOpen={Boolean(request)} onClose={() => onAnswer(null)} title={request?.title ?? ''} closeOnBackdropClick={false}>
      {request && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value) return;
            const answer = value;
            setValue('');
            onAnswer(answer);
          }}
        >
          <p className="text-sm text-fg-muted">{request.description}</p>
          {request.error && <p className="text-sm text-red-500">{request.error}</p>}
          <input
            type={request.secret === false ? 'text' : 'password'}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-md border border-edge bg-transparent px-2 py-1.5 text-sm text-fg outline-none focus:border-accent"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => onAnswer(null)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!value}>{request.submitLabel}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
