'use client';
import SshHistoryList from "@/components/SshHistoryList";
import Layout from "@/components/Layout";

export default function SshHistoryPage() {
    return (
        <Layout title="SSH 命令历史">
            <SshHistoryList />
        </Layout>
    );
}