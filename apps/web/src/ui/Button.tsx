import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'link';
  size?: 'md' | 'lg';
  children: ReactNode;
};

export function Button({ variant = 'default', size = 'md', className, children, ...rest }: Props) {
  const cls = [
    styles.root,
    variant === 'primary' ? styles.primary : '',
    variant === 'link' ? styles.link : '',
    size === 'lg' ? styles.lg : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
    </button>
  );
}
