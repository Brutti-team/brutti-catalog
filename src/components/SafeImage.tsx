import type { ImgHTMLAttributes } from "react";
import { publicAssetUrl } from "../lib/assets";
/** Keep missing or unavailable photographs from breaking the editor/table layout. */
export default function SafeImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...props}
      src={publicAssetUrl(props.src)}
      onError={(event) => {
        if (!event.currentTarget.src.endsWith("/images/placeholder.svg"))
          event.currentTarget.src = publicAssetUrl("/images/placeholder.svg");
      }}
    />
  );
}
