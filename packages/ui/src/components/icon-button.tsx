import { ComponentProps, splitProps } from "solid-js"
import { Icon, type IconProps } from "./icon"

export interface IconButtonProps extends ComponentProps<"button"> {
  icon: IconProps["name"]
  size?: "small" | "normal" | "large"
  variant?: "primary" | "secondary" | "ghost"
}

export function IconButton(props: IconButtonProps) {
  const [split, rest] = splitProps(props, ["icon", "size", "variant", "class", "classList"])
  return (
    <button
      {...rest}
      data-component="icon-button"
      data-size={split.size || "normal"}
      data-variant={split.variant || "ghost"}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <Icon name={split.icon} size={split.size || "normal"} />
    </button>
  )
}
