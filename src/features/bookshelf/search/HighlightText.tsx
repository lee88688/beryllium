import { Fragment } from "react";

export type HighlightTextProps = {
  text: string;
  query: string;
};

/**
 * Wraps the first literal occurrence of `query` in a themed `<mark>`.
 * The search matcher ignores punctuation/whitespace, so a normalized hit may
 * not have a direct substring; in that case the text is rendered unchanged.
 */
export function HighlightText({ text, query }: HighlightTextProps) {
  const needle = query.trim();
  if (needle === "") return <>{text}</>;

  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return <>{text}</>;

  return (
    <Fragment>
      {text.slice(0, index)}
      <mark className="bg-primary-soft rounded-[2px] px-0.5 text-inherit">
        {text.slice(index, index + needle.length)}
      </mark>
      {text.slice(index + needle.length)}
    </Fragment>
  );
}
