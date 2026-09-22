import type { KeyboardEvent } from "react";

export function handleComposerKeys(
  event: KeyboardEvent<HTMLTextAreaElement>,
  submit: () => void,
): void {
  if (
    !event.nativeEvent.isComposing &&
    event.key === "Enter" &&
    (event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    submit();
  }
}
