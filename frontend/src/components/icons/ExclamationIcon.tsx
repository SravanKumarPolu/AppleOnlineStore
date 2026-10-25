import React from 'react';
import { IconProps, iconSizes } from './IconProps';

export const ExclamationIcon: React.FC<IconProps> = ({ 
  size = 'md', 
  className = '', 
  ...props 
}) => {
  return (
    <svg
      className={`${iconSizes[size]} ${className}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      {...props}
    >
      <path 
        strokeLinecap="round" 
        strokeLinejoin="round" 
        strokeWidth={2} 
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
      />
    </svg>
  );
}; 