import React from 'react';
import { mediaSlots } from './media.js';

export function MediaSlot({ slot, className = '' }) {
  const media = mediaSlots[slot];
  if (!media) throw new Error(`Unknown Atlas media slot: ${slot}`);

  const classes = ['media-slot', media.src ? 'media-slot--filled' : 'media-slot--empty', className]
    .filter(Boolean)
    .join(' ');
  const image = media.src && <img className="media-slot__image" src={media.src} alt={media.alt} loading={media.loading || 'eager'} decoding="async" />;

  return <div className={classes} data-media-slot={slot}>
    {media.src
      ? media.mobileSrc
        ? <picture className="media-slot__picture"><source media="(max-width: 760px)" srcSet={media.mobileSrc} />{image}</picture>
        : image
      : <div className="media-slot__placeholder" aria-label={`${media.product}: скриншот приложения появится здесь`}>
          <span className="media-slot__brand" aria-hidden="true">{media.product}</span>
          <span className="media-slot__caption">Скриншот приложения</span>
        </div>}
  </div>;
}

export default MediaSlot;
