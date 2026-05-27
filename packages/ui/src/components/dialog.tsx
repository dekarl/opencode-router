import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ComponentProps, JSXElement, ParentProps, Show } from "solid-js"
import { IconButton } from "./icon-button"

export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  size?: "normal" | "large" | "x-large"
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
  transition?: boolean
}

export function Dialog(props: DialogProps) {
  return (
    <div
      data-component="dialog"
      data-fit={props.fit ? true : undefined}
      data-size={props.size || "normal"}
      data-transition={props.transition ? true : undefined}
    >
      <div data-slot="dialog-container">
        <Kobalte.Content
          data-slot="dialog-content"
          data-no-header={!props.title && !props.action ? "" : undefined}
          classList={{
            ...props.classList,
            [props.class ?? ""]: !!props.class,
          }}
          onOpenAutoFocus={(e) => {
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              autofocusEl.focus()
            }
          }}
        >
          <Show when={props.title}>
            <div data-slot="dialog-header">
              <Kobalte.Title data-slot="dialog-title">{props.title}</Kobalte.Title>
              <Kobalte.CloseButton aria-label="Close" as={IconButton} icon="close" size="small" />
            </div>
          </Show>
          <div data-slot="dialog-body">{props.children}</div>
          <Show when={props.action}>
            <div data-slot="dialog-footer">{props.action}</div>
          </Show>
        </Kobalte.Content>
      </div>
    </div>
  )
}
