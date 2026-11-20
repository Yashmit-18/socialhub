import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

/**
 * react-hook-form + the shared Zod schema, plus mapping of server-side field errors
 * (422/409 `details.fields`) back onto the form. `formError` holds non-field errors.
 */
export function useApiForm(schema, options = {}) {
  const form = useForm({ resolver: zodResolver(schema), mode: 'onTouched', ...options });
  const [formError, setFormError] = useState(null);

  const submit = (handler) =>
    form.handleSubmit(async (values) => {
      setFormError(null);
      try {
        await handler(values);
      } catch (err) {
        const fields = err?.fields ?? {};
        let mapped = false;
        for (const [name, message] of Object.entries(fields)) {
          if (name in form.getValues()) {
            form.setError(name, { type: 'server', message });
            mapped = true;
          }
        }
        if (!mapped) {
          // A field the form does not have (e.g. a nested server-side field): show its message
          // rather than the generic one.
          const [firstUnmapped] = Object.values(fields);
          setFormError(firstUnmapped ?? err?.message ?? 'Something went wrong. Please try again.');
        }
      }
    });

  return {
    ...form,
    submit,
    formError,
    setFormError,
    errors: form.formState.errors,
    isSubmitting: form.formState.isSubmitting,
  };
}
