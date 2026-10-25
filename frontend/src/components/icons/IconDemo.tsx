import React from 'react';
import {
  UserIcon,
  EmailIcon,
  LockIcon,
  EyeIcon,
  CheckIcon,
  ExclamationIcon,
  ShieldIcon,
  GoogleIcon,
  FacebookIcon,
  ValidationIcon,
  
} from './index';

const IconDemo: React.FC = () => {
  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Icon Components Demo</h1>
        
        {/* Size Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Size Variants</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-6">
            {(['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const).map((size) => (
              <div key={size} className="flex flex-col items-center p-4 bg-white rounded-lg shadow-sm">
                <UserIcon size={size} className="text-blue-600 mb-2" />
                <span className="text-sm font-medium text-gray-600">{size}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Form Icons */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Form Field Icons</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">User Icon</h3>
              <div className="space-y-3">
                <UserIcon size="md" className="text-gray-500" />
                <UserIcon size="md" className="text-blue-600" />
                <UserIcon size="md" className="text-green-600" />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Email Icon</h3>
              <div className="space-y-3">
                <EmailIcon size="md" className="text-gray-500" />
                <EmailIcon size="md" className="text-blue-600" />
                <EmailIcon size="md" className="text-green-600" />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Lock Icon</h3>
              <div className="space-y-3">
                <LockIcon size="md" className="text-gray-500" />
                <LockIcon size="md" className="text-blue-600" />
                <LockIcon size="md" className="text-green-600" />
              </div>
            </div>
          </div>
        </section>

        {/* Password Visibility Toggle */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Password Visibility Toggle</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Eye Icon (Visible)</h3>
              <div className="space-y-3">
                <EyeIcon size="md" isVisible={true} className="text-gray-500" />
                <EyeIcon size="md" isVisible={true} className="text-blue-600" />
                <EyeIcon size="md" isVisible={true} className="text-green-600" />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Eye Icon (Hidden)</h3>
              <div className="space-y-3">
                <EyeIcon size="md" isVisible={false} className="text-gray-500" />
                <EyeIcon size="md" isVisible={false} className="text-blue-600" />
                <EyeIcon size="md" isVisible={false} className="text-green-600" />
              </div>
            </div>
          </div>
        </section>

        {/* Validation Icons */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Validation Icons</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Success Icons</h3>
              <div className="space-y-3">
                <CheckIcon size="sm" className="text-green-600" />
                <CheckIcon size="md" className="text-green-600" />
                <CheckIcon size="lg" className="text-green-600" />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Error Icons</h3>
              <div className="space-y-3">
                <ExclamationIcon size="sm" className="text-red-600" />
                <ExclamationIcon size="md" className="text-red-600" />
                <ExclamationIcon size="lg" className="text-red-600" />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Validation Icons</h3>
              <div className="space-y-3">
                <ValidationIcon size="sm" isValid={true} className="text-green-600" />
                <ValidationIcon size="sm" isValid={false} className="text-gray-500" />
                <ValidationIcon size="md" isValid={true} className="text-green-600" />
                <ValidationIcon size="md" isValid={false} className="text-gray-500" />
              </div>
            </div>
          </div>
        </section>

        {/* Authentication Icons */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Authentication Icons</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Shield Icon (Biometric)</h3>
              <div className="space-y-3">
                <ShieldIcon size="md" className="text-purple-600" />
                <ShieldIcon size="lg" className="text-purple-600" />
                <ShieldIcon size="xl" className="text-purple-600" />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Social Login Icons</h3>
              <div className="space-y-3">
                <GoogleIcon size="md" />
                <FacebookIcon size="md" className="text-blue-600" />
              </div>
            </div>
          </div>
        </section>

        {/* Interactive Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Interactive Examples</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Hover Effects</h3>
              <div className="space-y-3">
                <UserIcon 
                  size="lg" 
                  className="text-gray-500 hover:text-blue-600 hover:scale-110 transition-all duration-200 cursor-pointer" 
                />
                <EmailIcon 
                  size="lg" 
                  className="text-gray-500 hover:text-blue-600 hover:scale-110 transition-all duration-200 cursor-pointer" 
                />
                <LockIcon 
                  size="lg" 
                  className="text-gray-500 hover:text-blue-600 hover:scale-110 transition-all duration-200 cursor-pointer" 
                />
              </div>
            </div>
            
            <div className="p-6 bg-white rounded-lg shadow-sm">
              <h3 className="text-lg font-medium text-gray-800 mb-4">Animation Examples</h3>
              <div className="space-y-3">
                <CheckIcon 
                  size="lg" 
                  className="text-green-600 animate-pulse" 
                />
                <ExclamationIcon 
                  size="lg" 
                  className="text-red-600 animate-bounce" 
                />
                <ShieldIcon 
                  size="lg" 
                  className="text-purple-600 animate-spin" 
                />
              </div>
            </div>
          </div>
        </section>

        {/* Usage Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6">Usage Examples</h2>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-medium text-gray-800 mb-4">Code Examples</h3>
            <div className="space-y-4">
              <div>
                <h4 className="text-md font-medium text-gray-700 mb-2">Basic Usage:</h4>
                <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
{`import { UserIcon } from '../components/icons';

<UserIcon size="md" className="text-blue-600" />`}
                </pre>
              </div>
              
              <div>
                <h4 className="text-md font-medium text-gray-700 mb-2">With Props:</h4>
                <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
{`<EyeIcon 
  size="lg" 
  isVisible={showPassword} 
  className="text-gray-500 hover:text-gray-700" 
  onClick={togglePassword}
/>`}
                </pre>
              </div>
              
              <div>
                <h4 className="text-md font-medium text-gray-700 mb-2">Validation Example:</h4>
                <pre className="bg-gray-100 p-3 rounded text-sm overflow-x-auto">
{`<ValidationIcon 
  size="sm" 
  isValid={password.length >= 8} 
  className={password.length >= 8 ? 'text-green-600' : 'text-gray-500'} 
/>`}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default IconDemo; 