import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('exposes full-width copy hooks without embedding manual line breaks', () => {
    const description = '完整說明文字應依可用寬度自然換行，不應被固定窄欄刻意切斷。';
    const { container } = render(
      <PageHeader title="組織共現網絡" description={description} />,
    );

    expect(screen.getByRole('heading', { name: '組織共現網絡' })).toHaveClass('page-header__title');
    expect(screen.getByText(description)).toHaveClass('page-header__description');
    expect(container.querySelector('.page-header__copy')).toBeInTheDocument();
    expect(container.querySelector('.page-header br')).not.toBeInTheDocument();
  });
});
