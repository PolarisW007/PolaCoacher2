import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Form,
  Select,
  Slider,
  Radio,
  Switch,
  Button,
  Spin,
  message,
  Typography,
} from 'antd';
import {
  SaveOutlined,
  SoundOutlined,
  DashboardOutlined,
  BgColorsOutlined,
  SettingOutlined,
  TranslationOutlined,
} from '@ant-design/icons';
import { ttsApi, settingsApi } from '../api/documents';

const { Text } = Typography;

function SettingSection({ icon, title, children }) {
  return (
    <div style={{
      padding: '20px 0',
      borderBottom: '1px solid rgba(226,234,243,0.6)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 16,
      }}>
        <span style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(45,206,137,0.15), rgba(17,205,239,0.08))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#2dce89', fontSize: 14,
        }}>
          {icon}
        </span>
        <Text strong style={{ fontSize: 14, color: '#1a2332' }}>{title}</Text>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voices, setVoices] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, voicesRes] = await Promise.all([settingsApi.get(), ttsApi.voices()]);
      setVoices(voicesRes.data || []);
      const s = settingsRes.data || {};
      form.setFieldsValue({
        voice_id: s.voice_id,
        speech_rate: s.speech_rate ?? 1.0,
        theme: s.theme || 'light',
        auto_play_next: s.auto_play_next ?? false,
        show_translation: s.show_translation ?? false,
      });
    } catch (err) {
      message.error('加载设置失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await settingsApi.update(values);
      message.success('设置已保存');
    } catch (err) {
      if (err.errorFields) return;
      message.error('保存失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  const genderLabel = (g) => {
    if (g === 'male' || g === '男') return '男声';
    if (g === 'female' || g === '女') return '女声';
    return g || '';
  };

  return (
    <div className="fade-in" style={{ maxWidth: 620, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
          个人设置
        </div>
        <Text style={{ color: '#8896a8', fontSize: 13 }}>自定义你的学习体验</Text>
      </div>

      <Spin spinning={loading}>
        <Card
          style={{
            borderRadius: 14,
            border: '1px solid rgba(226,234,243,0.8)',
            boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
          }}
          styles={{ body: { padding: '0 24px 24px' } }}
        >
          <Form form={form} layout="vertical" requiredMark={false}>

            <SettingSection icon={<SoundOutlined />} title="语音设置">
              <Form.Item name="voice_id" label={<Text style={{ color: '#5a6a7e', fontSize: 13 }}>TTS 音色</Text>} style={{ marginBottom: 16 }}>
                <Select
                  placeholder="选择语音音色"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ borderRadius: 10 }}
                  options={voices.map((v) => ({
                    value: v.id || v.voice_id,
                    label: `${v.name}（${genderLabel(v.gender)}）`,
                  }))}
                />
              </Form.Item>

              <Form.Item name="speech_rate" label={<Text style={{ color: '#5a6a7e', fontSize: 13 }}>语速</Text>} style={{ marginBottom: 0 }}>
                <Slider
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  marks={{ 0.5: '慢', 1.0: '标准', 1.5: '较快', 2.0: '快' }}
                  tooltip={{ formatter: (v) => `${v}x` }}
                  trackStyle={{ background: 'linear-gradient(90deg, #2dce89, #11cdef)' }}
                  handleStyle={{ borderColor: '#2dce89', boxShadow: '0 0 0 4px rgba(45,206,137,0.15)' }}
                />
              </Form.Item>
            </SettingSection>

            <SettingSection icon={<BgColorsOutlined />} title="界面主题">
              <Form.Item name="theme" style={{ marginBottom: 0 }}>
                <Radio.Group>
                  <Radio.Button value="light" style={{ borderRadius: '8px 0 0 8px' }}>浅色模式</Radio.Button>
                  <Radio.Button value="dark" disabled style={{ borderRadius: '0 8px 8px 0' }}>
                    深色模式（开发中）
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>
            </SettingSection>

            <SettingSection icon={<SettingOutlined />} title="播放偏好">
              <Form.Item
                name="auto_play_next"
                label={<Text style={{ color: '#5a6a7e', fontSize: 13 }}>自动播放下一页</Text>}
                valuePropName="checked"
                style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}
              >
                <Switch />
              </Form.Item>

              <Form.Item
                name="show_translation"
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TranslationOutlined />
                    <Text style={{ color: '#5a6a7e', fontSize: 13 }}>默认显示翻译</Text>
                  </span>
                }
                valuePropName="checked"
                style={{ marginBottom: 0 }}
              >
                <Switch />
              </Form.Item>
            </SettingSection>

            <div style={{ paddingTop: 24 }}>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                size="large"
                loading={saving}
                onClick={handleSave}
                style={{
                  background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                  border: 'none',
                  borderRadius: 12,
                  height: 46,
                  paddingInline: 32,
                  fontWeight: 600,
                  boxShadow: '0 4px 14px rgba(45,206,137,0.35)',
                  letterSpacing: '0.5px',
                }}
              >
                保存设置
              </Button>
            </div>
          </Form>
        </Card>
      </Spin>
    </div>
  );
}
