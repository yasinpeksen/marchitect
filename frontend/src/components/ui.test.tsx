import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Badge, Button, Card, Empty, ErrorBox, Field, Notice, PageHeader, Pagination, pageCountFor, Spinner, StatCard, statusTone } from './ui';

describe('Button', () => {
  it('renders its label and handles clicks', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('is disabled while loading or when disabled', () => {
    const { rerender } = render(<Button loading>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    rerender(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
  it('applies the variant styles', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('bg-red-600');
  });
});

describe('Card', () => {
  it('renders title, actions and body', () => {
    render(<Card title="Stats" actions={<button>Act</button>}>Body text</Card>);
    expect(screen.getByRole('heading', { name: 'Stats' })).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });
  it('omits the header without title or actions', () => {
    render(<Card>Only body</Card>);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('Badge and statusTone', () => {
  it('renders its text with a tone', () => {
    render(<Badge tone="green">ok</Badge>);
    expect(screen.getByText('ok').className).toContain('emerald');
  });
  it.each([['ACTIVE', 'green'], ['failed', 'red'], ['partial', 'amber'], ['running', 'blue'], ['unknown', 'gray'], [null, 'gray'], [undefined, 'gray']])('maps %s -> %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

describe('feedback components', () => {
  it('Spinner shows a default and custom label', () => {
    const { rerender } = render(<Spinner />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    rerender(<Spinner label="Signing in" />);
    expect(screen.getByText('Signing in')).toBeInTheDocument();
  });
  it('ErrorBox shows Error messages and strings, and nothing without an error', () => {
    const { rerender, container } = render(<ErrorBox error={new Error('Boom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    rerender(<ErrorBox error="plain" />);
    expect(screen.getByRole('alert')).toHaveTextContent('plain');
    rerender(<ErrorBox />);
    expect(container).toBeEmptyDOMElement();
  });
  it('Notice renders children in the chosen tone', () => {
    render(<Notice tone="amber">Careful</Notice>);
    expect(screen.getByText('Careful').className).toContain('amber');
  });
  it('Empty renders title, hint and action', () => {
    render(<Empty title="Nothing" hint="Add one" action={<button>Add</button>} />);
    expect(screen.getByText('Nothing')).toBeInTheDocument();
    expect(screen.getByText('Add one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});

describe('layout components', () => {
  it('PageHeader renders title, subtitle and actions', () => {
    render(<PageHeader title="Dashboard" subtitle="Overview" actions={<button>New</button>} />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
  it('StatCard renders label, value and hint', () => {
    render(<StatCard label="Ads" value={12} hint="3 new" />);
    expect(screen.getByText('Ads')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3 new')).toBeInTheDocument();
  });
  it('Field wraps a control with its label and hint', () => {
    render(<Field label="Name" hint="Required"><input /></Field>);
    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});

describe('pageCountFor', () => {
  it.each([[0, 10, 1], [10, 10, 1], [11, 10, 2], [95, 24, 4]])('%s items at %s per page -> %s pages', (total, size, pages) => expect(pageCountFor(total, size)).toBe(pages));
});

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(<Pagination page={1} pageSize={10} total={5} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('navigates and disables the edges', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={10} total={25} onChange={onChange} />);
    expect(screen.getByText(/25 results · page 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenCalledWith(2);
    rerender(<Pagination page={3} pageSize={10} total={25} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });
});
