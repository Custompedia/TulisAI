import { getSchema, type AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CellStyle } from './cell-style';
import { ListStyle } from './list-style';
import { PageBreak } from './page-break';
import { ParagraphFormat } from './paragraph-format';

// Every extension that shapes the document schema; the editor, the server and the DOCX mapper share this one list.
export const documentExtensions: AnyExtension[] = [
  StarterKit.configure({ code: false, codeBlock: false, link: { openOnClick: false, autolink: true, protocols: ['http', 'https'] } }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Table.configure({ resizable: true, cellMinWidth: 40 }), TableRow, TableHeader, TableCell,
  TextStyle, FontFamily, FontSize, Color, BackgroundColor,
  Highlight.configure({ multicolor: true }), Subscript, Superscript,
  TaskList, TaskItem.configure({ nested: true }),
  ParagraphFormat, ListStyle, CellStyle, PageBreak,
];

export const documentSchema = getSchema(documentExtensions);
