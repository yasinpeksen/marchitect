import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { dataState } from '@/testing/mocks';
import { mergeTags, TagInput } from './tag-input';

describe('mergeTags', () => {
  it('normalises, de-duplicates and appends', () => expect(mergeTags(['a'], ' B  C , a,, d ')).toEqual(['a', 'b c', 'd']));
  it('returns the same array when nothing is added', () => {
    const existing = ['a'];
    expect(mergeTags(existing, ' , ')).toBe(existing);
  });
  it('splits on newlines (pasted lists)', () => expect(mergeTags([], 'x\ny')).toEqual(['x', 'y']));
  it('caps at the maximum', () => expect(mergeTags(['a', 'b'], 'c,d,e', 3)).toEqual(['a', 'b', 'c']));
});

describe('TagInput', () => {
  const Harness = ({ initial = [] as string[], onChange = vi.fn() }) => {
    const [tags, setTags] = useState(initial);
    return <TagInput tags={tags} onChange={(next) => { onChange(next); setTags(next); }} />;
  };

  it('adds a tag on Enter and clears the draft', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByPlaceholderText(/Type a keyword/);
    fireEvent.change(input, { target: { value: 'Summer' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['summer']);
    expect(screen.getByText('summer')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('adds tags when a comma is typed', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText(/Type a keyword/), { target: { value: 'a, b' } });
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('adds the draft on blur', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(/Type a keyword/);
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    expect(screen.getByText('x')).toBeInTheDocument();
  });

  it('removes a tag with its button and the last tag with Backspace', () => {
    const onChange = vi.fn();
    render(<Harness initial={['a', 'b']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('does not remove a tag with Backspace while typing', () => {
    const onChange = vi.fn();
    render(<Harness initial={['a']} onChange={onChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('splits pasted lists and ignores plain pastes', () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(/Type a keyword/);
    fireEvent.paste(input, { clipboardData: { getData: () => 'one,two\nthree' } });
    expect(screen.getByText('three')).toBeInTheDocument();
    const preventDefault = vi.fn();
    fireEvent.paste(input, { clipboardData: { getData: () => 'plain' }, preventDefault });
    expect(screen.queryByText('plain')).toBeNull();
  });

  it('offers suggestions from the API as datalist options', () => {
    dataState.responses['/search/tags'] = [{ tag: 'summer' }, { tag: 'sale' }];
    const { container } = render(<Harness />);
    expect([...container.querySelectorAll('datalist option')].map((option) => option.getAttribute('value'))).toEqual(['summer', 'sale']);
  });
});
