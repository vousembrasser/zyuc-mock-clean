'use client';
import EventStream from "@/components/EventStream";
import Layout from "@/components/Layout";

export default function HomePage() {
    return (
        <Layout title="实时事件流">
            <EventStream />
        </Layout>
    );
}