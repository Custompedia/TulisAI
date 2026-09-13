'use client';

import Image from 'next/image';
import { ArrowDown, ArrowRight, BookOpen, Check, CheckCheck, Columns2, FileText, History, LockKeyhole, PenLine, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { useLocale } from '@/lib/client/locale';
import { MODES, modeHint, modeIcon, modeLabel } from '@/components/writing/modes';
import styles from './LandingSections.module.css';

function Heading({ title, description }: { title: string; description?: string }) {
  return <div className={styles.heading}><h2>{title}</h2>{description && <p>{description}</p>}</div>;
}

function FeatureIllustration({ kind }: { kind: 'modes' | 'protection' | 'versions' }) {
  const { t } = useLocale();
  return <div className={styles.featureVisual}>
    <Image src={`/images/landing/feature-${kind}.webp`} alt="" width={1024} height={1024} sizes="(max-width: 680px) 90vw, 33vw" className={styles.featureImage} />
    <div className={styles.miniWindow}>
      <div className={styles.miniBar}><span className={styles.miniBrand}><PenLine size={12} />{t('Ruang tulisanmu', 'Your writing space')}</span><span className={styles.windowDots} aria-hidden="true">•••</span></div>
      {kind === 'modes' && <><div className={styles.modeGrid}>{MODES.map(mode => { const Icon = modeIcon[mode]; return <span key={mode} className={mode === 'academic' ? styles.selectedMode : undefined}><Icon size={15} /><span>{modeLabel(mode, t)}</span>{mode === 'academic' && <Check size={10} />}</span>; })}</div><p className={styles.miniFoot}><Sparkles size={11} />{t('Satu tulisan. Banyak kemungkinan.', 'One draft. Many possibilities.')}</p></>}
      {kind === 'protection' && <><p className={styles.paperText}>{t('Penelitian ini menggunakan', 'This study uses')} <mark>Structural Equation Modeling</mark> {t('untuk menganalisis hubungan antarvariabel', 'to analyse relationships between variables')} <mark>(Hair et al., 2019)</mark>.</p><div className={styles.protectionStatus}><ShieldCheck size={14} /><span>{t('Istilah & sitasi tetap utuh', 'Terms & citations preserved')}</span><Check size={12} /></div></>}
      {kind === 'versions' && <><div className={styles.versionRow}><span><FileText size={13} />{t('Teks asli', 'Original text')}</span><small>01</small></div><div className={styles.versionRow}><span><Sparkles size={13} />{t('Versi akademik', 'Academic version')}</span><small>02</small></div><div className={`${styles.versionRow} ${styles.currentVersion}`}><span><CheckCheck size={13} />{t('Versi pilihanmu', 'Your chosen version')}</span><Check size={12} /></div><p className={styles.miniFoot}><History size={12} />{t('Selalu bisa kembali', 'Always a way back')}</p></>}
    </div>
  </div>;
}

function AudienceAndFeatures() {
  const { t } = useLocale();
  const features = [
    { kind: 'modes' as const, title: t('Pilih gaya tulisanmu', 'Find your writing style'), text: t('Dari akademik hingga kreatif. Sesuaikan cara menyampaikan, tanpa kehilangan makna.', 'From academic to creative. Change how you say it, while keeping what you mean.') },
    { kind: 'protection' as const, title: t('Jaga istilah dan sitasi', 'Keep terms and citations intact'), text: t('Kunci bagian yang harus tetap persis. Tulisan berkembang, referensi tetap terjaga.', 'Lock the parts that must stay exact. Your writing evolves; your references stay put.') },
    { kind: 'versions' as const, title: t('Lihat perubahan, simpan kendali', 'See every change. Stay in control.'), text: t('Bandingkan, pilih, dan pulihkan versi. Setiap keputusan tetap milikmu.', 'Compare, choose, and restore versions. Every decision stays yours.') },
  ];
  return <>
    <div className={`${styles.container} ${styles.audience}`}><p>{t('Untuk siapa pun yang punya sesuatu untuk disampaikan', 'For everyone with something to say')}</p><div><span><BookOpen size={19} />{t('Mahasiswa', 'Students')}</span><span><FileText size={19} />{t('Peneliti', 'Researchers')}</span><span><Columns2 size={19} />{t('Profesional', 'Professionals')}</span><span><PenLine size={19} />{t('Kreator', 'Creators')}</span></div></div>
    <section id="produk" className={`${styles.container} ${styles.section}`}><Heading title={t('Semua yang tulisanmu butuhkan.\nDalam satu ruang.', 'Everything your writing needs.\nIn one place.')} /><div className={styles.featureGrid}>{features.map(feature => <article key={feature.kind} className={styles.featureCard}><FeatureIllustration kind={feature.kind} /><div className={styles.featureCopy}><h3>{feature.title}</h3><p>{feature.text}</p></div></article>)}</div></section>
  </>;
}

function Workflow() {
  const { t } = useLocale();
  const steps = [t('Masukkan tulisan', 'Bring your draft'), t('Pilih mode', 'Choose a mode'), t('Tinjau dan terapkan', 'Review and apply')];
  return <section id="cara-kerja" className={`${styles.container} ${styles.section} ${styles.workflow}`}>
    <div className={styles.workflowIntro}><span className={styles.eyebrow}>{t('DARI IDE KE TULISAN', 'FROM THOUGHT TO TEXT')}</span><h2>{t('Mulai dengan idemu.\nTemukan kata yang tepat.', 'Start with your idea.\nFind the right words.')}</h2><p>{t('Tidak perlu merangkai prompt. Cukup tulisanmu dan arah yang ingin kamu tuju.', 'No prompts to craft. Just your writing and where you want to take it.')}</p><ol>{steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}</ol></div>
    <ol className={styles.workflowCanvas}>{steps.map((step, index) => <li key={step}><div className={styles.stepHeading}><h3>{step}</h3><span>{index + 1}/3</span></div>{index === 0 && <><div className={styles.flowNote}><FileText size={17} /><div><strong>{t('Draft pertamaku', 'My first draft')}</strong><p>{t('Penelitian ini dimaksudkan guna melakukan analisis…', 'This study is intended for carrying out an analysis…')}</p></div></div><ArrowDown className={styles.flowArrow} size={20} /><div className={styles.flowNote}><LockKeyhole size={16} /><div><strong>{t('Tandai yang penting', 'Keep what matters')}</strong><p>{t('Istilah & sitasi dikunci', 'Terms & citations locked')}</p></div></div><span className={styles.flowStatus}><Check size={12} />{t('Siap diperbaiki', 'Ready to refine')}</span></>}{index === 1 && <><div className={styles.flowNote}><span className={styles.darkIcon}><PenLine size={16} /></span><div><strong>{t('Akademik', 'Academic')}</strong><p>{t('Jelas, formal, terstruktur', 'Clear, formal, structured')}</p></div></div><ArrowDown className={styles.flowArrow} size={20} /><div className={styles.flowNote}><Sparkles size={16} /><div><strong>{t('Saran penulisan', 'Writing suggestion')}</strong><p className={styles.flowSerif}>{t('Penelitian ini menganalisis…', 'This study analyses…')}</p></div></div><span className={styles.flowStatus}><ShieldCheck size={12} />{t('Makna tetap terjaga', 'Meaning preserved')}</span></>}{index === 2 && <><div className={styles.flowNote}><Columns2 size={16} /><div><strong>{t('Lihat perbedaannya', 'See the difference')}</strong><p>{t('Bandingkan dengan teks asli', 'Compare with your original')}</p></div></div><ArrowDown className={styles.flowArrow} size={20} /><div className={styles.flowNote}><CheckCheck size={16} /><div><strong>{t('Kamu yang memilih', 'The choice is yours')}</strong><p>{t('Terapkan saat sudah sesuai', 'Apply when it feels right')}</p></div></div><span className={`${styles.flowStatus} ${styles.darkStatus}`}><Check size={12} />{t('Versi baru tersimpan', 'New version saved')}</span></>}</li>)}</ol>
  </section>;
}

function ControlAndFacts() {
  const { t } = useLocale();
  const stages = [
    { icon: FileText, title: t('Teks asli', 'Original text'), label: t('Titik awalmu', 'Your starting point'), text: t('Saya ingin menyampaikan bahwa kegiatan ini memberikan manfaat yang cukup besar.', 'I would like to convey that this activity provides a fairly considerable benefit.'), foot: t('Tersimpan di riwayat', 'Kept in your history') },
    { icon: Sparkles, title: t('Saran AI', 'AI suggestion'), label: t('Lebih jelas, tetap setia', 'Clearer, still faithful'), text: t('Kegiatan ini memberikan manfaat yang besar.', 'This activity provides significant benefits.'), foot: t('Pratinjau sebelum diterapkan', 'Preview before applying') },
    { icon: CheckCheck, title: t('Versi pilihanmu', 'Your chosen version'), label: t('Sentuhan terakhirmu', 'Your finishing touch'), text: t('Kegiatan ini memberi manfaat nyata bagi peserta.', 'This activity offers meaningful benefits to participants.'), foot: t('Disunting dan dipilih olehmu', 'Edited and chosen by you') },
  ];
  const facts = [
    { number: '6', title: t('mode penulisan', 'writing modes'), detail: t('Satu ide, berbagai cara menyampaikannya.', 'One idea, different ways to express it.') },
    { number: '2', title: t('bahasa', 'languages'), detail: t('Bahasa Indonesia dan Inggris, dalam satu alur.', 'Indonesian and English, in one flow.') },
    { number: '1', title: t('ruang kerja', 'workspace'), detail: t('Dokumen, saran, dan versi. Semua berdekatan.', 'Documents, suggestions, and versions. Together.') },
  ];
  return <section className={`${styles.container} ${styles.section}`}><Heading title={t('AI membantu.\nKamu yang menentukan.', 'AI helps.\nYou make the call.')} description={t('Tulisan yang lebih baik, tanpa kehilangan suaramu sendiri.', 'Better writing, without losing your own voice.')} /><div className={styles.controlFrame}><Image src="/images/landing/feature-protection.webp" alt="" width={1024} height={1024} sizes="(max-width: 1160px) 100vw, 1160px" className={styles.controlBackdrop} /><div className={styles.controlInner}>{stages.map((stage, index) => <div className={styles.controlStage} key={stage.title}><div className={styles.controlTitle}><span className={index === 1 ? styles.darkIcon : styles.paleIcon}><stage.icon size={17} /></span><div><h3>{stage.title}</h3><p>{stage.label}</p></div></div><blockquote>{stage.text}</blockquote><small>{stage.foot}</small>{index < 2 && <ArrowRight className={styles.stageArrow} size={21} aria-hidden="true" />}</div>)}</div></div><p className={styles.controlCaption}><Columns2 size={13} />{t('Bandingkan perubahan', 'Compare changes')}<span aria-hidden="true">·</span><History size={13} />{t('Pulihkan versi kapan saja', 'Restore a version anytime')}</p><div className={styles.factGrid}>{facts.map((fact, index) => <article className={styles.fact} key={fact.number}><div className={styles.factMarks} aria-hidden="true">{Array.from({ length: 36 }, (_, mark) => <span key={mark} className={mark < ([30, 22, 13][index] ?? 0) ? styles.filledMark : undefined} />)}</div><p><strong>{fact.number}</strong><span>{fact.title}</span></p><small>{fact.detail}</small></article>)}</div></section>;
}

function ModesDiagram() {
  const { t } = useLocale();
  return <section id="mode" className={`${styles.container} ${styles.section}`}><Heading title={t('Banyak cara menulis.\nSatu tempat untuk tumbuh.', 'Many ways to write.\nOne place to grow.')} description={t('Dari gagasan pertama sampai kalimat terakhir, temukan mode yang sesuai.', 'From your first thought to your final sentence, find the mode that fits.')} /><div className={styles.modeDiagram}><svg className={styles.connectors} viewBox="0 0 1000 340" fill="none" preserveAspectRatio="none" aria-hidden="true"><path d="M500 160H415Q390 160 375 130L335 65Q325 50 305 50H160M500 160H160M500 160H415Q390 160 375 190L335 255Q325 270 305 270H160M500 160H585Q610 160 625 130L665 65Q675 50 695 50H840M500 160H840M500 160H585Q610 160 625 190L665 255Q675 270 695 270H840M500 160V312" /></svg><div className={styles.modeHub}><span><PenLine size={31} strokeWidth={1.5} /></span><p>AI Writing Workspace</p></div>{MODES.map((mode, index) => { const Icon = modeIcon[mode]; return <div className={`${styles.modeNode} ${styles[`node${index}`]}`} key={mode}><span className={styles.modeNodeIcon}><Icon size={19} strokeWidth={1.7} /></span><div><h3>{modeLabel(mode, t)}</h3><p>{modeHint(mode, t)}</p></div></div>; })}<div className={styles.customNode}><span><Plus size={14} />{modeLabel('custom', t)}</span><p>{t('Atur sesuai kebutuhanmu', 'Make it your own')}</p></div></div></section>;
}

function Faq() {
  const { t } = useLocale();
  const items = [
    [t('Apa itu AI Writing Workspace?', 'What is AI Writing Workspace?'), t('Ruang kerja untuk memperbaiki dan memparafrase tulisan dengan bantuan AI. Pilih mode, jaga istilah penting, lalu tinjau hasilnya sebelum diterapkan ke dokumen.', 'A workspace for refining and paraphrasing your writing with AI. Choose a mode, protect important terms, and review the result before applying it to your document.')],
    [t('Bahasa apa yang didukung?', 'Which languages are supported?'), t('Bahasa Indonesia dan Inggris. Pilih bahasa tulisan sesuai kebutuhan di dalam ruang kerja.', 'Indonesian and English. Choose the language for your writing inside the workspace.')],
    [t('Apa perbedaan setiap mode penulisan?', 'How do the writing modes differ?'), t('Standar untuk parafrase natural, Akademik untuk tulisan ilmiah, Humanize untuk bahasa yang lebih luwes, Profesional untuk komunikasi kerja, Kreatif untuk tulisan ekspresif, dan Sederhanakan untuk penjelasan yang mudah dipahami. Gunakan Kustom untuk mengatur hasil lebih spesifik.', 'Standard offers natural paraphrasing, Academic supports scholarly writing, Humanize makes wording more natural, Professional refines workplace communication, Creative adds expression, and Simplify makes explanations easier to understand. Use Custom for more specific settings.')],
    [t('Bagaimana istilah dan sitasi dilindungi?', 'How are terms and citations protected?'), t('Kunci istilah atau sitasi yang ingin dipertahankan persis. Hasil AI diperiksa terhadap bagian yang dilindungi dan ditolak jika bagian tersebut berubah.', 'Lock the terms or citations you want to preserve exactly. AI results are checked against protected text and rejected if it has changed.')],
    [t('Apakah hasil AI langsung mengganti tulisan saya?', 'Does AI replace my writing immediately?'), t('Tidak. Hasil muncul sebagai pratinjau. Kamu bisa membandingkan perubahan, memakai hasilnya, atau membuangnya. Dokumen baru berubah saat kamu memilih menerapkan hasil.', 'No. Results appear as a preview. You can compare changes, use the result, or discard it. Your document only changes when you choose to apply the result.')],
    [t('Bisakah saya kembali ke versi sebelumnya?', 'Can I return to an earlier version?'), t('Bisa. Teks asli dan riwayat versi tetap tersedia. Memulihkan versi sebelumnya membuat versi baru, sehingga riwayat yang sudah ada tetap tersimpan.', 'Yes. Your original text and version history remain available. Restoring an earlier version creates a new version, keeping your existing history intact.')],
    [t('Apakah Humanize menjamin lolos detektor AI?', 'Does Humanize guarantee bypassing AI detectors?'), t('Tidak. Humanize membantu tulisan terasa lebih natural dan tidak kaku sambil mempertahankan maknanya. Fitur ini bukan alat untuk menjamin hasil pendeteksi AI dan tidak sengaja menambahkan kesalahan.', 'No. Humanize helps writing feel more natural and less formulaic while preserving its meaning. It does not guarantee AI detector results or deliberately introduce mistakes.')],
  ];
  return <section id="faq" className={`${styles.container} ${styles.section} ${styles.faqSection}`}><Heading title={t('Ada pertanyaan?\nMari kita perjelas.', 'Questions?\nLet’s clear things up.')} description={t('Kenali ruang menulismu sedikit lebih dekat.', 'Get to know your writing space a little better.')} /><div className={styles.faqList}>{items.map(([question, answer], index) => <details key={question} name="landing-faq" open={index === 0 ? true : undefined}><summary><span>{question}</span><span className={styles.faqPlus} aria-hidden="true"><Plus size={18} /></span></summary><div className={styles.faqAnswer}><p>{answer}</p></div></details>)}</div></section>;
}

export function SupportingSections() {
  return <div className={styles.sections}><AudienceAndFeatures /><Workflow /><ControlAndFacts /><ModesDiagram /><Faq /></div>;
}
