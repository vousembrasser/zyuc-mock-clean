'use client';
import HistoryList from "@/components/HistoryList";
import Layout from "@/components/Layout";

export default function HistoryPage() {
    return (
        <Layout title="请求历史">
            <HistoryList />
        </Layout>
    );
}