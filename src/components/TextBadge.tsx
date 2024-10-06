import React, { ReactNode } from 'react';
import { Flexbox } from './base/Layout';

interface TextBadgeProps {
  name: string;
  className?: string;
  children: ReactNode;
}

const TextBadge: React.FC<TextBadgeProps> = ({ name, children }) => (
  <Flexbox direction="row" justify="between" className="border border-border rounded-md">
    <span className={`px-3 py-1 bg-bg-active border-r border-border text-text rounded-l-md`}>{name}</span>
    <span className={`flex-grow px-3 py-1 bg-bg text-text rounded-r-md`}>{children}</span>
  </Flexbox>
);

export default TextBadge;