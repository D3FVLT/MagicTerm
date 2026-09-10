import { useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { applySnippetVariables, type SnippetVariable } from '../lib/snippet-template';

interface SnippetVariablesModalProps {
  snippetName: string;
  template: string;
  variables: SnippetVariable[];
  /** Pre-fill, typically the last values used for this snippet in this session. */
  initialValues: Record<string, string>;
  submitLabel: string;
  onSubmit: (result: string, values: Record<string, string>) => void;
  onCancel: () => void;
}

export function SnippetVariablesModal({
  snippetName,
  template,
  variables,
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
}: SnippetVariablesModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      variables.map((variable) => [
        variable.name,
        initialValues[variable.name] ?? variable.defaultValue,
      ])
    )
  );

  const preview = useMemo(() => applySnippetVariables(template, values), [template, values]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(preview, values);
  };

  return (
    <Modal isOpen title={snippetName} onClose={onCancel} closeOnBackdropClick={false}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {variables.map((variable, index) => (
          <Input
            key={variable.name}
            label={variable.name}
            value={values[variable.name] ?? ''}
            placeholder={variable.defaultValue || variable.name}
            autoFocus={index === 0}
            // Pre-filled text starts selected so typing replaces it outright —
            // otherwise every reuse begins with clearing the previous value.
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [variable.name]: e.target.value }))
            }
          />
        ))}

        <div className="space-y-1">
          <span className="block text-sm font-medium text-fg-muted">Preview</span>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-edge bg-surface-2 px-3 py-2 font-mono text-xs text-fg">
            {preview}
          </pre>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
