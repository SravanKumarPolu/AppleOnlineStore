# Icon Components Library

A comprehensive collection of reusable SVG icon components for React applications, built with TypeScript and optimized for Tailwind CSS.

## Features

- **TypeScript Support**: Full type safety with proper interfaces
- **Tailwind CSS Integration**: Seamless styling with Tailwind classes
- **Multiple Sizes**: 7 different size variants (xs, sm, md, lg, xl, 2xl, 3xl)
- **Customizable**: Accept all standard SVG props
- **Accessible**: Proper ARIA attributes and semantic markup
- **Performance Optimized**: Lightweight and efficient

## Installation

The icon components are already included in your project. Simply import them from the icons directory:

```typescript
import { UserIcon, EmailIcon, LockIcon } from '../components/icons';
```

## Available Icons

### Form Field Icons
- `UserIcon` - User/Profile icon
- `EmailIcon` - Email/Envelope icon  
- `LockIcon` - Lock/Security icon

### Password Icons
- `EyeIcon` - Password visibility toggle (with `isVisible` prop)

### Validation Icons
- `CheckIcon` - Success/Checkmark icon
- `ExclamationIcon` - Error/Alert icon
- `ValidationIcon` - Dynamic validation state (with `isValid` prop)

### Authentication Icons
- `ShieldIcon` - Security/Biometric icon
- `GoogleIcon` - Google brand icon
- `FacebookIcon` - Facebook brand icon

## Basic Usage

### Simple Icon
```tsx
import { UserIcon } from '../components/icons';

<UserIcon size="md" className="text-blue-600" />
```

### With Custom Styling
```tsx
<UserIcon 
  size="lg" 
  className="text-gray-500 hover:text-blue-600 transition-colors duration-200" 
/>
```

### Interactive Icon
```tsx
<EyeIcon 
  size="md" 
  isVisible={showPassword} 
  className="text-gray-500 hover:text-gray-700 cursor-pointer" 
  onClick={togglePassword}
/>
```

## Size Variants

All icons support 7 different sizes:

| Size | Tailwind Class | Dimensions |
|------|----------------|------------|
| `xs` | `w-3 h-3` | 12px × 12px |
| `sm` | `w-4 h-4` | 16px × 16px |
| `md` | `w-5 h-5` | 20px × 20px |
| `lg` | `w-6 h-6` | 24px × 24px |
| `xl` | `w-8 h-8` | 32px × 32px |
| `2xl` | `w-10 h-10` | 40px × 40px |
| `3xl` | `w-12 h-12` | 48px × 48px |

## Props Interface

```typescript
interface IconProps extends SVGProps<SVGSVGElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  className?: string;
}
```

### Special Props

Some icons have additional props:

#### EyeIcon
```typescript
interface EyeIconProps extends IconProps {
  isVisible?: boolean; // Controls eye open/closed state
}
```

#### ValidationIcon
```typescript
interface ValidationIconProps extends IconProps {
  isValid: boolean; // Controls checkmark/circle state
}
```

## Styling Examples

### Form Field Icons
```tsx
// Default state
<UserIcon size="lg" className="text-gray-500" />

// Focus state
<UserIcon size="lg" className="text-blue-600" />

// Success state
<UserIcon size="lg" className="text-green-600" />
```

### Validation States
```tsx
// Error state
<ExclamationIcon size="md" className="text-red-600 animate-pulse" />

// Success state
<CheckIcon size="md" className="text-green-600 animate-bounce-gentle" />

// Dynamic validation
<ValidationIcon 
  size="sm" 
  isValid={isValid} 
  className={isValid ? 'text-green-600' : 'text-gray-500'} 
/>
```

### Interactive Effects
```tsx
// Hover effects
<UserIcon 
  size="lg" 
  className="text-gray-500 hover:text-blue-600 hover:scale-110 transition-all duration-200" 
/>

// Loading state
<CheckIcon 
  size="md" 
  className="text-green-600 animate-spin" 
/>

// Pulse animation
<ExclamationIcon 
  size="md" 
  className="text-red-600 animate-pulse" 
/>
```

## Real-World Examples

### Login Form Field
```tsx
<div className="relative">
  <input 
    type="email" 
    className="pl-12 pr-4 py-3 border rounded-lg" 
    placeholder="Enter email"
  />
  <div className="absolute inset-y-0 left-0 pl-4 flex items-center">
    <EmailIcon 
      size="md" 
      className="text-gray-500 transition-colors duration-200 group-focus-within:text-blue-600" 
    />
  </div>
</div>
```

### Password Field with Toggle
```tsx
<div className="relative">
  <input 
    type={showPassword ? "text" : "password"} 
    className="pl-12 pr-12 py-3 border rounded-lg" 
    placeholder="Enter password"
  />
  <div className="absolute inset-y-0 left-0 pl-4 flex items-center">
    <LockIcon size="md" className="text-gray-500" />
  </div>
  <button 
    type="button" 
    className="absolute inset-y-0 right-0 pr-4 flex items-center"
    onClick={() => setShowPassword(!showPassword)}
  >
    <EyeIcon 
      size="md" 
      isVisible={!showPassword} 
      className="text-gray-500 hover:text-gray-700" 
    />
  </button>
</div>
```

### Social Login Buttons
```tsx
<button className="flex items-center space-x-3 px-4 py-2 border rounded-lg">
  <GoogleIcon size="md" />
  <span>Continue with Google</span>
</button>

<button className="flex items-center space-x-3 px-4 py-2 border rounded-lg">
  <FacebookIcon size="md" className="text-blue-600" />
  <span>Continue with Facebook</span>
</button>
```

### Validation Messages
```tsx
{error && (
  <div className="flex items-center space-x-2 text-red-600">
    <ExclamationIcon size="sm" className="animate-pulse" />
    <span>{error}</span>
  </div>
)}

{success && (
  <div className="flex items-center space-x-2 text-green-600">
    <CheckIcon size="sm" className="animate-bounce-gentle" />
    <span>{success}</span>
  </div>
)}
```

## Accessibility

All icons include proper accessibility attributes:

- `aria-hidden="true"` for decorative icons
- Proper `role` attributes where needed
- Support for `aria-label` and `aria-describedby`
- Keyboard navigation support

## Performance

- Icons are optimized SVGs with minimal markup
- No external dependencies
- Tree-shakeable imports
- Efficient re-rendering with React.memo (if needed)

## Customization

### Adding New Icons

1. Create a new icon component following the existing pattern
2. Export it from `index.ts`
3. Add proper TypeScript interfaces
4. Include accessibility attributes

### Custom Sizes

You can override the default sizes by passing custom className:

```tsx
<UserIcon className="w-16 h-16 text-blue-600" />
```

### Custom Colors

Use Tailwind's color utilities or custom CSS:

```tsx
<UserIcon className="text-custom-blue" />
```

## Demo

See `IconDemo.tsx` for a comprehensive showcase of all icons with different sizes, colors, and interactions.

## Migration from Inline SVGs

If you're migrating from inline SVGs, simply replace:

```tsx
// Before
<svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
</svg>

// After
<UserIcon size="md" className="text-blue-600" />
```

## Best Practices

1. **Use semantic sizes**: Choose the most appropriate size for your use case
2. **Consistent styling**: Use consistent color schemes across your app
3. **Accessibility**: Always consider screen readers and keyboard navigation
4. **Performance**: Import only the icons you need
5. **Maintainability**: Use the icon components instead of inline SVGs

## Troubleshooting

### Icon not displaying
- Check that the icon is properly imported
- Verify the className includes proper sizing classes
- Ensure the parent container has sufficient space

### Styling not applying
- Make sure Tailwind CSS is properly configured
- Check that className is being passed correctly
- Verify color classes are available in your Tailwind config

### TypeScript errors
- Ensure you're importing from the correct path
- Check that all required props are provided
- Verify the IconProps interface is imported 