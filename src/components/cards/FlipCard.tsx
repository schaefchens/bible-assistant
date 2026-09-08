import type { ReactNode } from 'react';

type Props = {
  front: ReactNode;
  back: ReactNode;
  flipped: boolean;
  className?: string;
};

export function FlipCard({ front, back, flipped, className }: Props) {
  return (
    <div className={['perspective w-full h-full', className ?? ''].join(' ')}>
      <div className={['flip-card-inner', flipped ? 'is-flipped' : ''].join(' ')}>
        <div className="flip-card-face">{front}</div>
        <div className="flip-card-back">{back}</div>
      </div>
    </div>
  );
}
