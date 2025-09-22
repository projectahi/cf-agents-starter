import { Slot } from "@/components/slot/Slot";
import { Tooltip } from "@/components/tooltip/Tooltip";
import { cn } from "@/lib/utils";

export type AvatarProps = {
  as?: React.ElementType;
  className?: string;
  external?: boolean;
  href?: string;
  id?: number | string;
  image?: string;
  size?: "sm" | "md" | "base";
  toggled?: boolean;
  tooltip?: string;
  username: string;
};

const AvatarComponent = ({
  as,
  className,
  external,
  href,
  image,
  size = "base",
  toggled,
  username
}: AvatarProps) => {
  const normalizedName = username.trim();
  const initials =
    normalizedName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || normalizedName.charAt(0).toUpperCase();

  const sizeClass =
    size === "sm"
      ? "h-8 w-8 text-xs"
      : size === "md"
        ? "h-9 w-9 text-sm"
        : "h-10 w-10 text-sm";

  return (
    <Slot
      as={as ?? "div"}
      className={cn(
        "btn btn-secondary circular add-focus relative overflow-hidden flex items-center justify-center",
        {
          "add-size-sm": size === "sm",
          "add-size-md": size === "md",
          "add-size-base": size === "base",
          interactive: as === "button",
          "after:absolute after:top-0 after:left-0 after:z-10 after:size-full after:bg-black/10 after:opacity-0 after:transition-opacity hover:after:opacity-100 dark:after:bg-white/10":
            image,
          "after:opacity-100": image && toggled,
          toggle: !image && toggled
        },
        sizeClass,
        className
      )}
      href={href}
      rel={external ? "noopener noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      {image ? (
        <img
          className="w-full"
          height={size === "sm" ? 28 : size === "base" ? 32 : 36}
          width={size === "sm" ? 28 : size === "base" ? 32 : 36}
          src={image}
          alt={username}
        />
      ) : (
        <span className="text-100 font-bold leading-none">{initials}</span>
      )}
    </Slot>
  );
};

export const Avatar = ({ ...props }: AvatarProps) => {
  return props.tooltip ? (
    <Tooltip content={props.tooltip} className={props.className} id={props.id}>
      <AvatarComponent {...props} className={undefined} />
    </Tooltip>
  ) : (
    <AvatarComponent {...props} />
  );
};
