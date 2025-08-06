'use client';
import SshConfigList from "@/components/SshConfigList";
import Layout from "@/components/Layout";

export default function SshConfigsPage() {
    return (
        <Layout title="SSH 配置列表">
            <SshConfigList />
        </Layout>
    );
}