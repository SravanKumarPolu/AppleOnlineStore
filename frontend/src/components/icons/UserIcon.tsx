import React from 'react';
import { IconProps, iconSizes } from './IconProps';

export const UserIcon: React.FC<IconProps> = ({ 
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
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
      />
    </svg>
  );
}; 