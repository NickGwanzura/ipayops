'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useDialogFocus } from '@/app/dialog-focus';

type ConfirmOptions = { title?: string; message: string; confirmLabel?: string; tone?: 'danger' | 'default' };
type Request =
  | {
      kind: 'confirm';
      options: Required<Pick<ConfirmOptions, 'title' | 'message' | 'confirmLabel' | 'tone'>>;
      resolve: (value: boolean) => void;
    }
  | { kind: 'prompt'; message: string; defaultValue: string; resolve: (value: string | null) => void };

let open: ((request: Request) => void) | null = null;

const DESTRUCTIVE_VERBS = ['Archive', 'Cancel', 'Delete', 'Revoke', 'Void', 'Remove'];

/** Verb a message starts with ("Archive Acme?" -> "Archive"), used as the button label for destructive actions. */
function leadingVerb(message: string) {
  const word = message.trim().split(/\s+/)[0] || '';
  return DESTRUCTIVE_VERBS.includes(word) ? word : null;
}

/**
 * In-app replacement for window.confirm: `if (!(await confirmAction('Cancel JOB-1?'))) return;`
 * Messages that start with a destructive verb get a matching red button; falls back to the browser dialog
 * when no ConfirmHost is mounted (for example in tests).
 */
export function confirmAction(input: string | ConfirmOptions): Promise<boolean> {
  const options = typeof input === 'string' ? { message: input } : input;
  if (!open) return Promise.resolve(window.confirm(options.message));
  const verb = leadingVerb(options.message);
  const request = open;
  return new Promise((resolve) =>
    request({
      kind: 'confirm',
      resolve,
      options: {
        title: options.title || 'Please confirm',
        message: options.message,
        confirmLabel: options.confirmLabel || verb || 'Confirm',
        tone: options.tone || (verb ? 'danger' : 'default'),
      },
    }),
  );
}

/** In-app replacement for window.prompt; resolves to null when cancelled. */
export function promptText(message: string, defaultValue = ''): Promise<string | null> {
  if (!open) return Promise.resolve(window.prompt(message, defaultValue));
  const request = open;
  return new Promise((resolve) => request({ kind: 'prompt', message, defaultValue, resolve }));
}

/** Mount once near the root; renders whichever confirm/prompt dialog is currently requested. */
export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);
  useEffect(() => {
    open = setRequest;
    return () => {
      if (open === setRequest) open = null;
    };
  }, []);
  if (!request) return null;
  const finish = (value: boolean | string | null) => {
    if (request.kind === 'confirm') request.resolve(value === true);
    else request.resolve(typeof value === 'string' ? value : null);
    setRequest(null);
  };
  return (
    <ConfirmDialog
      key={request.kind === 'confirm' ? request.options.message : request.message}
      request={request}
      finish={finish}
    />
  );
}

function ConfirmDialog({ request, finish }: { request: Request; finish: (value: boolean | string | null) => void }) {
  const titleId = useId();
  const [text, setText] = useState(request.kind === 'prompt' ? request.defaultValue : '');
  const cancel = () => finish(request.kind === 'confirm' ? false : null);
  const dialog = useDialogFocus<HTMLDivElement>(cancel);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const title = request.kind === 'confirm' ? request.options.title : 'Enter details';
  return (
    <div
      className="workflow-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div
        ref={dialog}
        className="workflow-dialog confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            finish(request.kind === 'confirm' ? true : text);
          }}
        >
          <div className="workflow-dialog-head">
            <div>
              <h3 id={titleId}>{title}</h3>
              <p className="confirm-message">
                {request.kind === 'confirm' ? request.options.message : request.message}
              </p>
            </div>
          </div>
          {request.kind === 'prompt' && (
            <label className="workflow-field">
              <span>Reference</span>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            </label>
          )}
          <div className="workflow-dialog-actions">
            <button type="button" className="ops-btn ghost" onClick={cancel}>
              {request.kind === 'confirm' ? 'Go back' : 'Cancel'}
            </button>
            <button
              ref={confirmRef}
              type="submit"
              className={
                request.kind === 'confirm' && request.options.tone === 'danger' ? 'ops-btn blue danger' : 'ops-btn blue'
              }
            >
              {request.kind === 'confirm' ? request.options.confirmLabel : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
