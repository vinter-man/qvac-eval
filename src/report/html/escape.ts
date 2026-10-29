const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export class Safe {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => ESCAPES[character] ?? character);
}

export function raw(value: string): Safe {
  return new Safe(value);
}

export type Fragment = Safe | string | number | false | null | undefined | readonly Fragment[];

function render(fragment: Fragment): string {
  if (fragment === false || fragment === null || fragment === undefined) return '';
  if (fragment instanceof Safe) return fragment.value;
  if (typeof fragment === 'number') return String(fragment);
  if (typeof fragment === 'string') return escapeHtml(fragment);
  return fragment.map(render).join('');
}

export function html(strings: TemplateStringsArray, ...values: Fragment[]): Safe {
  let output = strings[0] ?? '';
  values.forEach((value, index) => {
    output += render(value) + (strings[index + 1] ?? '');
  });
  return new Safe(output);
}

export function join(fragments: readonly Fragment[], separator = ''): Safe {
  return new Safe(fragments.map(render).join(separator));
}
