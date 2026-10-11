import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, detectDelimiter, parseAmount, parseDate, detectDecimal, analyzeRows, rowsToTransactions } from '../js/parse.js';

test('detects delimiters', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('Fecha;Concepto;Importe\n01/01/2026;"Pago, con coma";-1,50'), ';');
});

test('parses quoted CSV', () => {
  const rows = parseCSV('a,b\n"x, y","he said ""hi"""\r\n1,2\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]);
});

test('parses Spanish and English amounts', () => {
  assert.equal(parseAmount('-1.234,56', ','), -1234.56);
  assert.equal(parseAmount('1234,5', ','), 1234.5);
  assert.equal(parseAmount('-45,23 €', ','), -45.23);
  assert.equal(parseAmount('−12,00', ','), -12);
  assert.equal(parseAmount('(12,00)', ','), -12);
  assert.equal(parseAmount('12,00-', ','), -12);
  assert.equal(parseAmount('-1,234.56', '.'), -1234.56);
  assert.equal(parseAmount('+10.99', '.'), 10.99);
  assert.equal(parseAmount(-3.5), -3.5);
  assert.ok(Number.isNaN(parseAmount('', ',')));
});

test('detects decimal separator', () => {
  assert.equal(detectDecimal(['-45,23', '1.234,56', '-3,00']), ',');
  assert.equal(detectDecimal(['-45.23', '1,234.56', '-3.00']), '.');
});

test('parses dates', () => {
  assert.equal(parseDate('10/10/2026'), '2026-10-10');
  assert.equal(parseDate('03/04/2026'), '2026-04-03');
  assert.equal(parseDate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(parseDate('2026-10-01'), '2026-10-01');
  assert.equal(parseDate('2026-10-01T12:00:00Z'), '2026-10-01');
  assert.equal(parseDate('1.2.26'), '2026-02-01');
  assert.equal(parseDate('11 oct 2026'), '2026-10-11');
  assert.equal(parseDate('11 Oct. 2026'), '2026-10-11');
  assert.equal(parseDate(46306), '2026-10-11');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('hola'), null);
});

const CAIXA = `Movimientos de la cuenta ES12 2100 **** **** 1234;;;;;
Fecha de descarga: 11/10/2026;;;;;
;;;;;
Fecha;Fecha valor;Movimiento;Más datos;Importe;Saldo
10/10/2026;10/10/2026;MERCADONA BARCELONA;COMPRA TARJ. 5402XXXXXXXX1234;-45,23;1.234,56
09/10/2026;09/10/2026;TRANSFERENCIA A FAVOR DE;NOMINA OCTUBRE EMPRESA SL;2.450,00;1.279,79
01/10/2026;01/10/2026;RECIBO NETFLIX.COM;;-13,99;-1.170,21
`;

test('analyzes a CaixaBank-style export with preamble rows', () => {
  const rows = parseCSV(CAIXA);
  const a = analyzeRows(rows);
  assert.equal(a.headerIdx, 2); // empty preamble rows are dropped
  assert.equal(a.mapping.date, 0);
  assert.deepEqual(a.mapping.desc, [2, 3]);
  assert.equal(a.mapping.amount, 4);
  assert.equal(a.mapping.balance, 5);
  assert.equal(a.mapping.decimal, ',');
  const { transactions, skipped } = rowsToTransactions(a.data, a.mapping);
  assert.equal(skipped, 0);
  assert.equal(transactions.length, 3);
  assert.deepEqual(transactions[0], { date: '2026-10-10', amount: -45.23, description: 'MERCADONA BARCELONA · COMPRA TARJ. 5402XXXXXXXX1234' });
  assert.equal(transactions[1].amount, 2450);
});

test('analyzes an English export with debit/credit columns', () => {
  const csv = `Date,Description,Money out,Money in,Balance
2026-10-01,Spotify,10.99,,500.00
2026-10-02,Salary,,3000.00,3489.01
`;
  const a = analyzeRows(parseCSV(csv));
  assert.equal(a.mapping.amount, -1);
  assert.equal(a.mapping.debit, 2);
  assert.equal(a.mapping.credit, 3);
  const { transactions } = rowsToTransactions(a.data, a.mapping);
  assert.deepEqual(transactions.map(t => t.amount), [-10.99, 3000]);
});

test('analyzes a Trade Republic-style export', () => {
  const csv = `Date,Type,Description,Amount,Balance
2026-10-01,Card transaction,SPOTIFY P2F3A1,-10.99,500.00
2026-10-02,Savings plan,Savings plan execution IE00BK5BQT80,-250.00,250.00
`;
  const a = analyzeRows(parseCSV(csv));
  assert.equal(a.mapping.date, 0);
  assert.equal(a.mapping.amount, 3);
  assert.ok(a.mapping.desc.includes(2));
  const { transactions } = rowsToTransactions(a.data, a.mapping);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[1].amount, -250);
});
