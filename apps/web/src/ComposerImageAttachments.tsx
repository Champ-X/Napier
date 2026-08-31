import type { Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";

import { composerCopy } from "./composer-copy";
import {
  composerImageDataUrl,
  type ComposerImageAttachment,
} from "./composer-image-attachments";

export function ComposerImageAttachments({
  images,
  setImages,
}: {
  images: readonly ComposerImageAttachment[];
  setImages: Dispatch<SetStateAction<ComposerImageAttachment[]>>;
}) {
  if (images.length === 0) return null;
  return (
    <div className="composer-image-attachments">
      <div
        className="composer-image-strip"
        role="list"
        aria-label={composerCopy.images.selected}
      >
        {images.map((image) => (
          <figure key={image.id} role="listitem">
            <img src={composerImageDataUrl(image)} alt="" />
            <figcaption title={image.name}>{image.name}</figcaption>
            <button
              type="button"
              aria-label={`${composerCopy.images.remove} ${image.name}`}
              onClick={() =>
                setImages((current) =>
                  current.filter((candidate) => candidate.id !== image.id),
                )
              }
            >
              <X size={13} aria-hidden="true" />
            </button>
          </figure>
        ))}
      </div>
      <p>{composerCopy.images.ephemeral}</p>
    </div>
  );
}
