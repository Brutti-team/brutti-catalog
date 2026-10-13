import type { ImgHTMLAttributes } from "react";
/** Keep missing or unavailable photographs from breaking the editor/table layout. */
export default function SafeImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      onError={(event) => {
        if (!event.currentTarget.src.endsWith("/images/placeholder.svg"))
          event.currentTarget.src = "/images/placeholder.svg";
      }}
    />
  );
}
