import React from 'react';

interface TitleProps {
  text1: string;
  text2: string;
}

const Title: React.FC<TitleProps> = ({ text1, text2 }) => {
  return (
    <div className="flex flex-col sm:flex-row items-center gap-3 mb-6">
      <p className="text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-gray-600 to-yellow-500">
        {text1}{' '}
        <span className="font-bold text-gray-600">{text2}</span>
      </p>
      <p className="w-full sm:w-20 h-[2px] bg-gradient-to-r from-gray-600 to-gray-300"></p>
    </div>
  );
};

export default Title;

