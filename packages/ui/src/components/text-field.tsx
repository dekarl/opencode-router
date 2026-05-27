import { TextField as Kobalte } from "@kobalte/core/text-field"
import { createSignal, Show, splitProps } from "solid-js"
import type { ComponentProps } from "solid-js"

export interface TextFieldProps
  extends ComponentProps<typeof Kobalte.Input>,
    Partial<
      Pick<
        ComponentProps<typeof Kobalte>,
        | "name"
        | "defaultValue"
        | "value"
        | "onChange"
        | "onKeyDown"
        | "validationState"
        | "required"
        | "disabled"
        | "readOnly"
      >
    > {
  label?: string
  hideLabel?: boolean
  description?: string
  error?: string
  variant?: "normal" | "ghost"
  copyable?: boolean
  copyKind?: "clipboard" | "link"
  multiline?: boolean
}

export function TextField(props: TextFieldProps) {
  const [local, others] = splitProps(props, [
    "name",
    "defaultValue",
    "value",
    "onChange",
    "onKeyDown",
    "validationState",
    "required",
    "disabled",
    "readOnly",
    "label",
    "hideLabel",
    "description",
    "error",
    "variant",
    "copyable",
    "copyKind",
    "multiline",
    "class",
    "classList",
    "children",
  ])

  const [copied, setCopied] = createSignal(false)

  const handleCopy = async () => {
    const text = String(local.value ?? "")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Kobalte
      data-component="text-field"
      data-variant={local.variant || "normal"}
      data-multiline={local.multiline ? "" : undefined}
      class={local.class}
      classList={local.classList}
      name={local.name}
      defaultValue={local.defaultValue}
      value={local.value}
      onChange={local.onChange}
      validationState={local.error ? "invalid" : local.validationState}
      required={local.required}
      disabled={local.disabled}
      readOnly={local.readOnly}
    >
      <Show when={local.label && !local.hideLabel}>
        <Kobalte.Label data-slot="text-field-label">{local.label}</Kobalte.Label>
      </Show>
      <div data-slot="text-field-input-wrapper">
        <Show
          when={local.multiline}
          fallback={<Kobalte.Input {...others} data-slot="text-field-input" />}
        >
          <Kobalte.TextArea {...others} data-slot="text-field-input" />
        </Show>
        <Show when={local.copyable}>
          <button type="button" onClick={handleCopy} data-slot="text-field-copy">
            {copied() ? "Copied" : "Copy"}
          </button>
        </Show>
      </div>
      <Show when={local.description}>
        <Kobalte.Description data-slot="text-field-description">{local.description}</Kobalte.Description>
      </Show>
      <Show when={local.error}>
        <Kobalte.ErrorMessage data-slot="text-field-error">{local.error}</Kobalte.ErrorMessage>
      </Show>
    </Kobalte>
  )
}
