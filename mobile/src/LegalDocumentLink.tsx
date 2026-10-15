import React, { useEffect, useState } from 'react';
import { Alert, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './design/theme';
import { fonts } from './design/typography';
import type { Language } from './types';
import bundledDocuments from './legalDocumentsContent.json';

export type LegalDocumentKind = 'privacy' | 'terms' | 'deletion';
type ContentNode = string | { tag: string; href?: string; children: ContentNode[] };
type DocumentContent = { title: string; date: string; sections: { title: string; body: ContentNode[] }[] };
type Documents = Record<LegalDocumentKind, DocumentContent>;
const localDocuments: Documents = bundledDocuments;
const paths: Record<string, LegalDocumentKind> = { '/privacy': 'privacy', '/terms': 'terms', '/delete-account': 'deletion' };

// The remote copy is optional: the complete bundled documents work without a connection.
function validDocuments(value: unknown): value is Documents {
  const validNode = (node: unknown, depth = 0): boolean => {
    if (typeof node === 'string') return true;
    if (!node || typeof node !== 'object' || depth > 20) return false;
    const item = node as Exclude<ContentNode, string>;
    return typeof item.tag === 'string' && (item.href === undefined || typeof item.href === 'string')
      && Array.isArray(item.children) && item.children.every(child => validNode(child, depth + 1));
  };
  if (!value || typeof value !== 'object') return false;
  return (['privacy', 'terms', 'deletion'] as const).every(kind => {
    const doc = (value as Documents)[kind];
    return doc && typeof doc.title === 'string' && typeof doc.date === 'string' && Array.isArray(doc.sections)
      && doc.sections.length > 0 && doc.sections.every(section => typeof section.title === 'string'
        && Array.isArray(section.body) && section.body.every(node => validNode(node)));
  });
}

export function LegalDocumentLink({ document, language = 'ru', children, style }: {
  document: LegalDocumentKind; language?: Language; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Pressable accessibilityRole="link" style={style} onPress={() => { Keyboard.dismiss(); setOpen(true); }}>{children}</Pressable>
    {open && <LegalDocumentReader initialDocument={document} language={language} onClose={() => setOpen(false)} />}
  </>;
}

export function LegalDocumentReader({ initialDocument, language, onClose }: {
  initialDocument: LegalDocumentKind; language: Language; onClose: () => void;
}) {
  const { palette } = useTheme();
  const [kind, setKind] = useState(initialDocument);
  const [documents, setDocuments] = useState(localDocuments);
  const [history, setHistory] = useState<LegalDocumentKind[]>([]);
  const closeLabel = language === 'en' ? 'Close' : language === 'ky' ? 'Жабуу' : 'Закрыть';
  const backLabel = language === 'en' ? 'Back' : language === 'ky' ? 'Артка' : 'Назад';
  const document = documents[kind];

  useEffect(() => {
    const abort = new AbortController();
    const source = process.env.EXPO_PUBLIC_PRIVACY_URL || process.env.EXPO_PUBLIC_TERMS_URL;
    if (!source) return;
    void (async () => {
      try {
        const url = new URL('/legal-documents.json', source);
        if (url.protocol !== 'https:') return;
        const response = await fetch(url.toString(), { signal: abort.signal });
        if (!response.ok) return;
        const content: unknown = await response.json();
        if (!abort.signal.aborted && validDocuments(content)) setDocuments(content);
      } catch { /* Keep the full offline copy on network failure. */ }
    })();
    return () => abort.abort();
  }, []);

  const navigate = (next: LegalDocumentKind) => {
    if (next === kind) return;
    setHistory(previous => [...previous, kind]);
    setKind(next);
  };
  const goBack = () => {
    const previous = history[history.length - 1];
    if (!previous) { onClose(); return; }
    setKind(previous);
    setHistory(items => items.slice(0, -1));
  };
  const openLink = (href: string) => {
    const path = href.split(/[?#]/)[0].replace(/\/$/, '');
    const next = paths[path];
    if (next) { navigate(next); return; }
    // Legal pages only contain support email links besides other documents.
    if (href.startsWith('mailto:')) void Linking.openURL(href).catch(() => {
      Alert.alert(language === 'en' ? 'Support' : 'Поддержка', 'atlas.delivery.kg@gmail.com');
    });
  };
  const inline = (nodes: ContentNode[]): React.ReactNode => nodes.map((node, index) => {
    if (typeof node === 'string') return node;
    return <Text key={index} accessibilityRole={node.href ? 'link' : undefined}
      onPress={node.href ? () => openLink(node.href!) : undefined}
      style={node.href ? { color: palette.accent, textDecorationLine: 'underline' } : node.tag === 'strong' || node.tag === 'b' ? styles.bold : undefined}>
      {node.tag === 'br' ? '\n' : inline(node.children)}
    </Text>;
  });
  const blocks = (nodes: ContentNode[]): React.ReactNode => nodes.map((node, index) => {
    if (typeof node === 'string') return <Text key={index} style={[styles.paragraph, { color: palette.ink }]}>{node}</Text>;
    if (node.tag === 'thead') return null;
    if (['p', 'a', 'caption', 'td', 'th', 'li'].includes(node.tag)) {
      return <Text key={index} selectable={!node.href} accessibilityRole={node.href ? 'link' : undefined}
        onPress={node.href ? () => openLink(node.href!) : undefined}
        style={[styles.paragraph, { color: palette.ink }, ['th', 'caption'].includes(node.tag) && styles.bold,
          node.href && { color: palette.accent, textDecorationLine: 'underline' }]}>{inline(node.children)}</Text>;
    }
    return <View key={index} style={node.tag === 'tr' ? [styles.tableRow, { backgroundColor: palette.elevated }] : undefined}>{blocks(node.children)}</View>;
  });

  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={goBack}>
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.surface }]}>
      <View style={[styles.header, { borderBottomColor: palette.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={goBack} style={styles.headerButton}>
          <Text style={[styles.back, { color: palette.ink }]}>‹</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: palette.ink }]}>{language === 'en' ? 'Documents' : language === 'ky' ? 'Документтер' : 'Документы'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={styles.headerButton}>
          <Text style={{ color: palette.accent }}>{closeLabel}</Text>
        </Pressable>
      </View>
      <ScrollView key={kind} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>{document.title}</Text>
        <Text style={[styles.metadata, { color: palette.muted }]}>Atlas · Atlas pro · Atlas Restaurant{ '\n' }{document.date}</Text>
        <View style={styles.tabs}>
          {(['privacy', 'terms', 'deletion'] as const).map(next => <Pressable key={next} accessibilityRole="button" accessibilityState={{ selected: kind === next }} onPress={() => navigate(next)} style={[styles.tab, { backgroundColor: kind === next ? palette.accent : palette.elevated }]}>
            <Text style={{ color: kind === next ? palette.accentText : palette.ink }}>{next === 'privacy' ? 'Конфиденциальность' : next === 'terms' ? 'Условия' : 'Удаление аккаунта'}</Text>
          </Pressable>)}
        </View>
        {document.sections.map(section => <View key={section.title} style={styles.section}>
          <Text accessibilityRole="header" style={[styles.heading, { color: palette.ink }]}>{section.title}</Text>
          {blocks(section.body)}
        </View>)}
        <Text style={[styles.metadata, { color: palette.muted }]}>Редакция 1.0 · {document.date}</Text>
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, minHeight: 56 },
  headerButton: { minHeight: 44, minWidth: 60, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, fontFamily: fonts.semibold, fontSize: 17, textAlign: 'center' }, back: { fontSize: 34, lineHeight: 38 },
  content: { padding: 22, paddingBottom: 40 }, title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34 },
  metadata: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: 12 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 22 }, tab: { paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', borderRadius: 12 },
  section: { marginBottom: 24 }, heading: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 26, marginBottom: 14 },
  paragraph: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, marginBottom: 12 }, bold: { fontFamily: fonts.semibold },
  tableRow: { borderRadius: 14, padding: 14, marginBottom: 12 },
});
