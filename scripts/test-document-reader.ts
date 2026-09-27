import { reconstructPdfPageText } from '../src/services/documentReader'

const text = reconstructPdfPageText([
  { str: 'PUNE', transform: [1, 0, 0, 1, 100, 680.2], width: 30, height: 10 },
  { str: 'MUMBAI', transform: [1, 0, 0, 1, 50, 700], width: 40, height: 10 },
  { str: 'To:', transform: [1, 0, 0, 1, 10, 680], width: 12, height: 10 },
  { str: 'From:', transform: [1, 0, 0, 1, 10, 700], width: 28, height: 10 },
  { str: '07:10', transform: [1, 0, 0, 1, 10, 660], width: 25, height: 10 },
])

if (text !== 'From: MUMBAI\nTo: PUNE\n07:10') {
  throw new Error(`PDF text order or spacing was reconstructed incorrectly: ${JSON.stringify(text)}`)
}

console.log('PASS  PDF text is sorted by page position and words retain their spacing')