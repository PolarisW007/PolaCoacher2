import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Card,
  Form,
  Select,
  Slider,
  Radio,
  Switch,
  Button,
  Spin,
  message,
  Divider,
} from 'antd';
import { SaveOutlined, SoundOutlined } from '@ant-design/icons';
import { ttsApi, settingsApi } from '../api/documents';

const { Title, Text } = Typography;

export default function SettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [voices, setVoices] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, voicesRes] = await Promise.all([
        settingsApi.get(),
        ttsApi.voices(),
      ]);
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

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    <div className="fade-in" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ margin: 0 }}>
          个人设置
        </Title>
      </div>

      <Spin spinning={loading}>
        <Card style={{ borderRadius: 12 }}>
          <Form form={form} layout="vertical" requiredMark={false}>
            <Form.Item
              name="voice_id"
              label={
                <span>
                  <SoundOutlined style={{ marginRight: 6 }} />
                  TTS 音色
                </span>
              }
            >
              <Select
                placeholder="选择语音音色"
                allowClear
                showSearch
                optionFilterProp="label"
                options={voices.map((v) => ({
                  value: v.id || v.voice_id,
                  label: `${v.name}（${genderLabel(v.gender)}）`,
                }))}
              />
            </Form.Item>

            <Form.Item name="speech_rate" label="语速">
              <Slider
                min={0.5}
                max={2.0}
                step={0.1}
                marks={{
                  0.5: '0.5x',
                  1.0: '1.0x',
                  1.5: '1.5x',
                  2.0: '2.0x',
                }}
                tooltip={{ formatter: (v) => `${v}x` }}
              />
            </Form.Item>

            <Divider />

            <Form.Item name="theme" label="主题">
              <Radio.Group>
                <Radio.Button value="light">浅色模式</Radio.Button>
                <Radio.Button value="dark" disabled>
                  深色模式（开发中）
                </Radio.Button>
              </Radio.Group>
            </Form.Item>

            <Divider />

            <Form.Item
              name="auto_play_next"
              label="自动播放下一页"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name="show_translation"
              label="默认显示翻译"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>

            <Divider />

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                size="large"
                loading={saving}
                onClick={handleSave}
                style={{
                  background: '#2dce89',
                  borderColor: '#2dce89',
                  borderRadius: 8,
                }}
              >
                保存设置
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Spin>
    </div>
  );
}
