import React from 'react';
import { tokenizeDescriptionHashtags } from '../src/lib/missionDescription';

type Props = {
  text: string;
  className?: string;
  clampClassName?: string;
};

const MissionDescriptionText: React.FC<Props> = ({
  text,
  className = 'text-xs font-medium leading-snug text-slate-100/90',
  clampClassName = 'line-clamp-2',
}) => {
  const tokens = tokenizeDescriptionHashtags(text);

  return (
    <p className={`${className} ${clampClassName}`}>
      {tokens.map((token, index) =>
        token.kind === 'hashtag' ? (
          <span key={`${token.value}-${index}`} className="text-cyan-400 font-semibold">
            {token.value}
          </span>
        ) : (
          <React.Fragment key={`${index}-${token.value}`}>{token.value}</React.Fragment>
        )
      )}
    </p>
  );
};

export default MissionDescriptionText;
