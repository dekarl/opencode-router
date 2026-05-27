import {
  createContext,
  createSignal,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"

type DialogNode = {
  id: string
  node: JSX.Element
  onClose?: () => void
}

const Context = createContext<{
  show: (render: () => JSX.Element, onClose?: () => void) => void
  close: () => void
}>()

let idCounter = 0

export function DialogProvider(props: ParentProps) {
  const [active, setActive] = createSignal<DialogNode | undefined>()

  const show = (render: () => JSX.Element, onClose?: () => void) => {
    const id = String(++idCounter)
    setActive({ id, node: render(), onClose })
  }

  const close = () => {
    const current = active()
    if (current?.onClose) current.onClose()
    setActive(undefined)
  }

  return (
    <Context.Provider value={{ show, close }}>
      {props.children}
      {active()?.node}
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  if (!ctx) throw new Error("useDialog must be used within DialogProvider")
  return ctx
}
