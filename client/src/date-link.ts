import { html, css } from "lit";

type DateClickHandler = (date: string) => void;

const DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;

export const dateLinkStyles = css`
  .date-link {
    padding: 0 0.1rem;
    border-radius: 4px;
    cursor: pointer;
    color: inherit;
    background: transparent;
    border: none;
    font: inherit;
    display: inline;
  }

  .date-link:hover,
  .date-link:focus-visible {
    background: #e0e7ff;
    outline: none;
  }
`;

export function renderTextWithDateLinks(text: string, onClick: DateClickHandler): Array<string | ReturnType<typeof html>> {
  if (!text) {
    return [""];
  }

  const segments: Array<string | ReturnType<typeof html>> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  const normalized = text.replace(/\r\n/g, "\n");
  while ((match = DATE_PATTERN.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      segments.push(normalized.slice(lastIndex, match.index));
    }
    const value = match[0];
    segments.push(
      html`<span
        class="date-link"
        role="button"
        tabindex="0"
        @click=${() => onClick(value)}
        @keydown=${(event: KeyboardEvent) => handleDateLinkKeydown(event, value, onClick)}
      >${value}</span>`
    );
    lastIndex = DATE_PATTERN.lastIndex;
  }
  if (lastIndex < normalized.length) {
    segments.push(normalized.slice(lastIndex));
  }
  if (!segments.length) {
    return [normalized];
  }
  return segments;
}

function handleDateLinkKeydown(event: KeyboardEvent, value: string, handler: DateClickHandler) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handler(value);
  }
}
