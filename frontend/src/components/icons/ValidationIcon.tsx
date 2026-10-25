import React from 'react';
import { IconProps, iconSizes } from './IconProps';

interface ValidationIconProps extends IconProps {
  isValid: boolean;
}

export const ValidationIcon: React.FC<ValidationIconProps> = ({ 
  size = 'md', 
  className = '', 
  isValid,
  ...props 
}) => {
  return (
    <svg
      className={`${iconSizes[size]} ${className}`}
      fill="currentColor"
      viewBox="0 0 20 20"
      {...props}
    >
      {isValid ? (
        <path 
          fillRule="evenodd" 
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" 
          clipRule="evenodd" 
        />
      ) : (
        <path 
          fillRule="evenodd" 
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" 
          clipRule="evenodd" 
        />
      )}
    </svg>
  );
}; 